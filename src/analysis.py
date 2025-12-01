"""Statistical analysis and recommendations for blackjack."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Tuple

from .models import Decision
from .storage import Storage


class BlackjackAnalyzer:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    def aggregate_decisions(self) -> Dict[Tuple[int, str], Dict[str, int]]:
        breakdown = defaultdict(lambda: {d.value: 0 for d in Decision})
        for row in self.storage.decision_breakdown():
            breakdown[(row["initial_total"], row["dealer_card"])][row["decision"]] = row["count"]
        return breakdown

    def recommendation(self, player_total: int, dealer_card: str) -> str | None:
        rows = self.storage.decision_outcomes(player_total, dealer_card)
        if not rows:
            return None

        summary: Dict[str, Dict[str, int]] = defaultdict(lambda: {"win": 0, "lose": 0, "tie": 0})
        for row in rows:
            summary[row["decision"]][row["result"]] = row["count"]

        best_decision = None
        best_win_rate = -1.0
        formatted_lines = []

        for decision, outcomes in summary.items():
            total = sum(outcomes.values()) or 1
            win_rate = outcomes["win"] / total
            lose_rate = outcomes["lose"] / total
            tie_rate = outcomes["tie"] / total
            formatted_lines.append(
                f"{decision.title()}: {win_rate*100:.1f}% win / {lose_rate*100:.1f}% lose / {tie_rate*100:.1f}% tie (n={total})"
            )
            if win_rate > best_win_rate:
                best_decision = decision
                best_win_rate = win_rate

        formatted = "\n".join(formatted_lines)
        return f"Recomendación basada en {sum(sum(v.values()) for v in summary.values())} manos similares:\n{formatted}\nSugerencia: {best_decision.title()}"
