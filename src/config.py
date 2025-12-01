"""Configuration loader for the Gambler Helper bot."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    token: str
    database_path: str = "data/gambler_helper.db"
    guild_whitelist: set[str] | None = None
    unbelieva_bot_ids: set[int] | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        """Load settings from environment variables.

        Expected variables:
            DISCORD_TOKEN: bot token
            DATABASE_PATH: optional path to SQLite database
            GUILD_WHITELIST: optional comma-separated guild IDs
            UNBELIEVA_BOT_IDS: optional comma-separated bot IDs for Unbelieva
        """

        token = os.environ.get("DISCORD_TOKEN")
        if not token:
            raise RuntimeError("DISCORD_TOKEN is required")

        database_path = os.environ.get("DATABASE_PATH", "data/gambler_helper.db")
        guilds = os.environ.get("GUILD_WHITELIST")
        whitelist = {g.strip() for g in guilds.split(",") if g.strip()} if guilds else None

        unbelieva_ids = os.environ.get("UNBELIEVA_BOT_IDS")
        unbelieva_bot_ids = (
            {int(bot_id) for bot_id in unbelieva_ids.split(",") if bot_id.strip()}
            if unbelieva_ids
            else None
        )

        return cls(token=token, database_path=database_path, guild_whitelist=whitelist, unbelieva_bot_ids=unbelieva_bot_ids)
