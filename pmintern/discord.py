"""Discord Webhook and Bot API client: rich embed alerts with direct apply links."""
from __future__ import annotations

import html
import time
from typing import Any

from .http import FetchError, post_json

STATUS_EMOJI = {
    "new": "✨", "saved": "💾", "applied": "✅", "interview": "🎯",
    "offer": "🎉", "rejected": "❌", "ignored": "🚫",
}

REGION_FLAGS = {
    "us": "🇺🇸",
    "ca": "🇨🇦",
    "na": "🇨🇦/🇺🇸",
    "uk": "🇬🇧",
    "apac": "🌏",
    "remote": "🌐",
    "unknown": "📍",
}

TRACK_LABELS = {
    "pm": "📋 Product Management",
    "swe": "💻 Software Engineering",
}

# Color palette (decimal integer for Discord embed sidebar)
COLOR_PM = 0x6366F1       # Indigo / Purple
COLOR_SWE = 0x10B981      # Emerald Green
COLOR_DIGEST = 0x3B82F6   # Sky Blue


class Discord:
    """Sends rich embed notifications to Discord via Webhook or Bot Channel API."""

    def __init__(self, webhook_url: str = "", bot_token: str = "", channel_id: str = ""):
        self.webhook_url = webhook_url.strip()
        self.bot_token = bot_token.strip()
        self.channel_id = channel_id.strip()

        if not self.webhook_url and not (self.bot_token and self.channel_id):
            raise ValueError(
                "Discord is not configured. Set DISCORD_WEBHOOK_URL, or DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in .env"
            )

    @property
    def is_bot(self) -> bool:
        return bool(self.bot_token and self.channel_id)

    def send_payload(self, payload: dict) -> dict:
        """Post a Discord message payload, automatically handling rate limits."""
        if self.is_bot:
            url = f"https://discord.com/api/v10/channels/{self.channel_id}/messages"
            headers = {
                "Authorization": f"Bot {self.bot_token}",
                "Content-Type": "application/json",
            }
            return post_json(url, payload, headers=headers)
        else:
            # Webhook mode: append wait=true so Discord returns created message details
            url = self.webhook_url
            sep = "&" if "?" in url else "?"
            target = f"{url}{sep}wait=true"
            return post_json(target, payload)

    def send_job_alert(self, job) -> dict:
        """Send a single rich embed job alert."""
        embed = build_job_embed(job)
        payload: dict[str, Any] = {
            "username": "Internship Watcher",
            "embeds": [embed],
        }

        # Discord component button (Apply link)
        if job.url:
            payload["components"] = [
                {
                    "type": 1,  # ActionRow
                    "components": [
                        {
                            "type": 2,  # Button
                            "style": 5,  # Link style (opens directly in browser)
                            "label": "Apply Now",
                            "url": job.url,
                            "emoji": {"name": "🚀"},
                        }
                    ],
                }
            ]

        return self.send_payload(payload)

    def send_digest(self, jobs: list, header: str = "") -> dict:
        """Send a formatted digest embed when tracker first seeds or overflows."""
        embed = build_digest_embed(jobs, header=header)
        payload = {
            "username": "Internship Watcher",
            "embeds": [embed],
        }
        return self.send_payload(payload)


def build_job_embed(job) -> dict:
    """Format one job into a Discord embed object."""
    track = getattr(job, "track", "pm") or "pm"
    region = getattr(job, "region", "unknown") or "unknown"
    flag = REGION_FLAGS.get(region, "📍")
    color = COLOR_SWE if track == "swe" else COLOR_PM
    track_name = TRACK_LABELS.get(track, track.upper())

    fields = [
        {"name": "🏢 Company", "value": f"**{job.company}**", "inline": True},
        {"name": "🎯 Track", "value": track_name, "inline": True},
        {"name": "📍 Location", "value": f"{flag} {job.location or 'Not specified'}", "inline": True},
    ]

    if job.posted_at:
        fields.append({"name": "📅 Posted", "value": job.posted_at[:10], "inline": True})
    if job.url:
        fields.append({"name": "🔗 Link", "value": f"[Open Job Posting]({job.url})", "inline": True})

    embed = {
        "title": f"{flag} [{track.upper()}] {job.title}",
        "url": job.url or None,
        "color": color,
        "description": f"New internship opening at **{job.company}**!",
        "fields": fields,
        "footer": {
            "text": f"Internship Watcher • Region: {region.upper()} • Source: {job.source}"
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return embed


def build_digest_embed(jobs: list, header: str = "") -> dict:
    """Format a list of jobs into a digest embed."""
    title = header or f"🎉 {len(jobs)} Open Internships Found"
    lines = []
    for job in jobs[:25]:
        track = getattr(job, "track", "pm") or "pm"
        region = getattr(job, "region", "unknown") or "unknown"
        flag = REGION_FLAGS.get(region, "📍")
        tag = f"`{track.upper()}`"
        link_str = f"[{job.company} — {job.title}]({job.url})" if job.url else f"{job.company} — {job.title}"
        loc_str = f" *({job.location})*" if job.location else ""
        lines.append(f"• {flag} {tag} {link_str}{loc_str}")

    if len(jobs) > 25:
        lines.append(f"\n*...and {len(jobs) - 25} more postings!*")
        lines.append("📁 **Full Directory:** [Browse JOBS.md on GitHub](https://github.com/leobyang/internship-watcher/blob/main/JOBS.md)")
        lines.append("💻 *Or inspect locally:* `python3 cli.py list`")

    desc = "\n".join(lines)
    if len(desc) > 4000:
        desc = desc[:3850] + "\n\n*(Truncated for Discord limit. View all: [JOBS.md](https://github.com/leobyang/internship-watcher/blob/main/JOBS.md) or run `python3 cli.py list`)*"

    return {
        "title": title,
        "color": COLOR_DIGEST,
        "description": desc,
        "footer": {"text": "Internship Watcher • PM & SWE Tracker (US, CA, UK, APAC)"},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
