"""Game tracking utilities for Unbelieva blackjack/roulette."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, Optional

import discord

from .analysis import BlackjackAnalyzer
from .models import BlackjackRecord, Decision, HandSnapshot, Result
from .storage import Storage

# Basic patterns for commands and textual decisions
BLACKJACK_COMMAND = re.compile(r"^\.(bj|blackjack)(\s+all|\s+\d+)?", re.IGNORECASE)
TEXT_DECISIONS = {"hit": Decision.HIT, "stand": Decision.STAND, "double down": Decision.DOUBLE, "double": Decision.DOUBLE}


@dataclass
class ActiveHand:
    player_id: int
    bet_amount: int
    initial_hand: HandSnapshot
    dealer_card: str
    last_total: int
    guild_id: int


class GameTracker:
    """Track table state and deduce player decisions from Unbelieva embeds."""

    def __init__(self, storage: Storage, analyzer: BlackjackAnalyzer):
        self.storage = storage
        self.analyzer = analyzer
        self.active_hands: Dict[int, ActiveHand] = {}

    def track_command(self, message: discord.Message) -> bool:
        return bool(BLACKJACK_COMMAND.match(message.content))

    def register_initial_hand(self, player_id: int, guild_id: int, bet_amount: int, player_cards: list[str], player_total: int, dealer_card: str) -> None:
        self.active_hands[player_id] = ActiveHand(
            player_id=player_id,
            bet_amount=bet_amount,
            initial_hand=HandSnapshot(cards=player_cards, total=player_total),
            dealer_card=dealer_card,
            last_total=player_total,
            guild_id=guild_id,
        )

    def parse_blackjack_embed(self, embed: discord.Embed) -> Optional[dict]:
        """Extract game info from an Unbelieva blackjack embed.

        The exact formatting can vary per locale; adjust the field names if needed.
        """

        title = (embed.title or "").lower()
        if "blackjack" not in title:
            return None

        data = {"bet_amount": 0, "player_cards": [], "dealer_card": "", "player_total": 0, "result": None}

        for field in embed.fields:
            name = field.name.lower()
            value = field.value
            if "bet" in name:
                data["bet_amount"] = int(re.sub(r"[^0-9]", "", value) or 0)
            elif "your hand" in name or "player" in name:
                cards = re.findall(r"[akqj0-9]{1,2}[♠♣♥♦]", value, re.IGNORECASE)
                total_match = re.search(r"total:\s*(\d+)", value, re.IGNORECASE)
                data["player_cards"] = cards
                if total_match:
                    data["player_total"] = int(total_match.group(1))
            elif "dealer" in name:
                card_match = re.search(r"[akqj0-9]{1,2}[♠♣♥♦]", value, re.IGNORECASE)
                if card_match:
                    data["dealer_card"] = card_match.group(0)
            elif any(keyword in name for keyword in ["win", "lose", "bust", "tie"]):
                lowered = value.lower()
                if "win" in lowered:
                    data["result"] = Result.WIN
                elif "lose" in lowered or "bust" in lowered:
                    data["result"] = Result.LOSE
                elif "tie" in lowered or "push" in lowered:
                    data["result"] = Result.TIE

        return data if data["player_cards"] else None

    def handle_embed_update(self, message: discord.Message, embed: discord.Embed) -> Optional[str]:
        parsed = self.parse_blackjack_embed(embed)
        if not parsed:
            return None

        player_id = message.mentions[0].id if message.mentions else message.author.id
        hand = self.active_hands.get(player_id)

        # If we do not have a record yet, register a fresh hand
        if not hand:
            self.register_initial_hand(
                player_id=player_id,
                guild_id=message.guild.id if message.guild else 0,
                bet_amount=parsed["bet_amount"],
                player_cards=parsed["player_cards"],
                player_total=parsed["player_total"],
                dealer_card=parsed["dealer_card"],
            )
            return None

        decision = self._infer_decision(hand, parsed["player_total"], parsed["bet_amount"])
        if parsed["result"] and decision:
            record = BlackjackRecord(
                player_id=player_id,
                guild_id=hand.guild_id,
                bet_amount=parsed["bet_amount"] or hand.bet_amount,
                initial_hand=hand.initial_hand,
                dealer_card=hand.dealer_card,
                decision=decision,
                final_hand=HandSnapshot(cards=parsed["player_cards"], total=parsed["player_total"]),
                result=parsed["result"],
            )
            self.storage.save_blackjack(record)
            self.active_hands.pop(player_id, None)

            recommendation = self.analyzer.recommendation(hand.initial_hand.total, hand.dealer_card)
            return recommendation

        if decision:
            hand.last_total = parsed["player_total"]

        return None

    def _infer_decision(self, hand: ActiveHand, new_total: int, new_bet: int) -> Optional[Decision]:
        if new_total > hand.last_total:
            return Decision.HIT
        if new_bet > hand.bet_amount:
            return Decision.DOUBLE
        if new_total == hand.last_total:
            return Decision.STAND
        return None

    def handle_text_decision(self, message: discord.Message) -> Optional[Decision]:
        decision = TEXT_DECISIONS.get(message.content.lower())
        if decision and message.author.id in self.active_hands:
            self.active_hands[message.author.id].last_total = self.active_hands[message.author.id].last_total
        return decision
