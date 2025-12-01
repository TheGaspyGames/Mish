"""Entry point for the Gambler Helper Discord bot."""
from __future__ import annotations

import asyncio
import logging
import re

import discord
from discord.ext import commands

from .analysis import BlackjackAnalyzer
from .config import Settings
from .storage import Storage
from .tracker import GameTracker

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gambler-helper")


class GamblerHelper(commands.Bot):
    def __init__(self, settings: Settings) -> None:
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(command_prefix="!", intents=intents)

        self.settings = settings
        self.storage = Storage(settings.database_path)
        self.analyzer = BlackjackAnalyzer(self.storage)
        self.tracker = GameTracker(self.storage, self.analyzer)

    async def setup_hook(self) -> None:
        log.info("Gambler Helper ready to observe tables")

    async def on_ready(self) -> None:
        log.info("Logged in as %s", self.user)

    async def on_message(self, message: discord.Message) -> None:
        if message.author.id == self.user.id:  # type: ignore[attr-defined]
            return

        if self.settings.guild_whitelist and message.guild and str(message.guild.id) not in self.settings.guild_whitelist:
            return

        # Detect blackjack command from a player
        if not message.author.bot and self.tracker.track_command(message):
            log.info("Detected blackjack command from %s", message.author)

        # Listen for text decisions (hit, stand, double)
        self.tracker.handle_text_decision(message)

        # Process embeds from Unbelieva bot to infer state
        if message.embeds and (not self.settings.unbelieva_bot_ids or message.author.id in self.settings.unbelieva_bot_ids):
            for embed in message.embeds:
                recommendation = self.tracker.handle_embed_update(message, embed)
                if recommendation:
                    await message.channel.send(
                        f"Sugerencia Gambler Helper para <@{message.mentions[0].id if message.mentions else message.author.id}>:\n{recommendation}"
                    )

        await self.process_commands(message)

    @commands.command(name="ghstats")
    async def ghstats(self, ctx: commands.Context) -> None:
        """Return a compact summary of observed decisions."""
        breakdown = self.analyzer.aggregate_decisions()
        lines = []
        for (total, dealer), decisions in sorted(breakdown.items()):
            decision_counts = ", ".join(f"{k}:{v}" for k, v in decisions.items())
            lines.append(f"Total {total} vs {dealer}: {decision_counts}")
        await ctx.send("\n".join(lines) or "Aún no hay datos registrados.")


def main() -> None:
    settings = Settings.from_env()
    bot = GamblerHelper(settings)
    bot.run(settings.token)


if __name__ == "__main__":
    main()
