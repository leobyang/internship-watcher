"""Configuration: .env loading and project paths."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
DB_PATH = ROOT / "jobs.db"
COMPANIES_PATH = ROOT / "companies.json"


def load_env(path: Path = ENV_PATH) -> None:
    """Read KEY=VALUE lines from .env into os.environ without overwriting."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def get_int(name: str, default: int) -> int:
    try:
        return int(get(name) or default)
    except ValueError:
        return default


def get_bool(name: str, default: bool = False) -> bool:
    value = get(name).lower()
    if not value:
        return default
    return value in ("1", "true", "yes", "on")


def get_tracks() -> set[str]:
    raw = get("TRACKS", "pm,swe")
    items = {t.strip().lower() for t in raw.split(",") if t.strip()}
    return items or {"pm", "swe"}


def get_regions() -> set[str]:
    raw = get("REGIONS", "us,ca,na,uk,apac,remote,unknown")
    items = {r.strip().lower() for r in raw.split(",") if r.strip()}
    if "all" in items:
        return {"us", "ca", "na", "uk", "apac", "remote", "unknown", "foreign"}
    return items or {"us", "ca", "na", "uk", "apac", "remote", "unknown"}


def get_notifier() -> str:
    """Determine active notification service: 'discord', 'telegram', or 'both'."""
    configured = get("NOTIFIER").lower()
    if configured in ("discord", "telegram", "both"):
        return configured
    # Auto-detect from credentials
    has_discord = bool(get("DISCORD_WEBHOOK_URL") or (get("DISCORD_BOT_TOKEN") and get("DISCORD_CHANNEL_ID")))
    has_telegram = bool(get("TELEGRAM_BOT_TOKEN") and get("TELEGRAM_CHAT_ID"))
    if has_discord and has_telegram:
        return "both"
    if has_discord:
        return "discord"
    if has_telegram:
        return "telegram"
    return "discord"  # Default preferred


def set_env_value(key: str, value: str, path: Path = ENV_PATH) -> None:
    """Write KEY=value into .env, replacing the line if it already exists."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    replaced = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value
