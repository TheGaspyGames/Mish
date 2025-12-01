"""Domain models for tracking blackjack and roulette outcomes."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import List, Optional


class Decision(str, Enum):
    HIT = "hit"
    STAND = "stand"
    DOUBLE = "double"


class Result(str, Enum):
    WIN = "win"
    LOSE = "lose"
    TIE = "tie"


@dataclass
class HandSnapshot:
    cards: List[str]
    total: int


@dataclass
class BlackjackRecord:
    player_id: int
    guild_id: int
    bet_amount: int
    initial_hand: HandSnapshot
    dealer_card: str
    decision: Decision
    final_hand: HandSnapshot
    result: Result
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass
class RouletteRecord:
    player_id: int
    guild_id: int
    bet_amount: int
    bet_type: str
    result: str
    win_amount: int
    timestamp: datetime = field(default_factory=datetime.utcnow)
