"""SQLite-backed storage for gameplay records."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator, List, Tuple

from .models import BlackjackRecord, Decision, HandSnapshot, Result


class Storage:
    def __init__(self, db_path: str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self.connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS blackjack_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    guild_id INTEGER NOT NULL,
                    bet_amount INTEGER NOT NULL,
                    initial_cards TEXT NOT NULL,
                    initial_total INTEGER NOT NULL,
                    dealer_card TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    final_cards TEXT NOT NULL,
                    final_total INTEGER NOT NULL,
                    result TEXT NOT NULL,
                    timestamp TEXT NOT NULL
                )
                """
            )

    def save_blackjack(self, record: BlackjackRecord) -> None:
        with self.connection() as conn:
            conn.execute(
                """
                INSERT INTO blackjack_records (
                    player_id, guild_id, bet_amount, initial_cards, initial_total,
                    dealer_card, decision, final_cards, final_total, result, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.player_id,
                    record.guild_id,
                    record.bet_amount,
                    ",".join(record.initial_hand.cards),
                    record.initial_hand.total,
                    record.dealer_card,
                    record.decision.value,
                    ",".join(record.final_hand.cards),
                    record.final_hand.total,
                    record.result.value,
                    record.timestamp.isoformat(),
                ),
            )

    def fetch_stats(self) -> List[sqlite3.Row]:
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT initial_total, dealer_card, decision, result, COUNT(*) as count
                FROM blackjack_records
                GROUP BY initial_total, dealer_card, decision, result
                """
            ).fetchall()
        return list(rows)

    def decision_breakdown(self) -> List[sqlite3.Row]:
        """Return aggregated counts per (player_total, dealer_card, decision)."""
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT initial_total, dealer_card, decision, COUNT(*) as count
                FROM blackjack_records
                GROUP BY initial_total, dealer_card, decision
                ORDER BY initial_total
                """
            ).fetchall()
        return list(rows)

    def decision_outcomes(self, player_total: int, dealer_card: str) -> List[sqlite3.Row]:
        """Return counts of wins/losses/ties for each decision in a specific state."""
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT decision, result, COUNT(*) as count
                FROM blackjack_records
                WHERE initial_total = ? AND dealer_card = ?
                GROUP BY decision, result
                """,
                (player_total, dealer_card),
            ).fetchall()
        return list(rows)
