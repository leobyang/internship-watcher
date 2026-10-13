"""Watch individual job pages that cannot be discovered through any board.

Some employers (Google, Dayforce) render a job's own page server-side but gate
or omit the listing, so the page can be read once you have its URL even though
it can never be found by scanning. This polls those URLs and alerts the moment
a posting flips from "not yet open" to open.

Configured in watched_urls.json; state is kept in the meta table so it survives
between runs and in CI.
"""
from __future__ import annotations

import hashlib
import html
import json
import re

from . import store
from .config import ROOT
from .http import FetchError, get_text
from .match import classify_track, location_region
from .models import Job

CONFIG_PATH = ROOT / "watched_urls.json"


def load() -> list[dict]:
    if not CONFIG_PATH.exists():
        return []
    return [w for w in json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if w.get("enabled", True)]


def visible_text(page: str) -> str:
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", page, flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", body)).split())


def state_of(text: str, watch: dict) -> str:
    """'open', 'closed', or 'unknown' for one fetched page."""
    low = text.lower()
    gone = [p.lower() for p in watch.get("open_when_gone", [])]
    present = [p.lower() for p in watch.get("open_when_present", [])]

    # Check common closed / not found markers
    closed_markers = (
        "job not found",
        "page not found",
        "no longer available",
        "position has been filled",
        "this job is closed",
        "no longer accepting applications",
    )
    if any(marker in low for marker in closed_markers):
        return "closed"

    # If gate message is still on the page, it's still closed
    if gone and any(p in low for p in gone):
        return "closed"          # the "not yet accepting" notice is still up

    # If open indicators are specified, check if any are present
    if present and any(p in low for p in present):
        return "open"

    # If only 'gone' is specified without 'present', it opens when the gate message disappears
    if gone and not present:
        return "open"

    return "closed" if present else "unknown"


def _key(url: str) -> str:
    return "urlwatch:" + hashlib.sha1(url.encode()).hexdigest()[:16]


def check(conn, watch: dict, record: bool = True) -> tuple[str, str, str]:
    """Return (state, previous_state, title_or_detail). Never raises for a fetch failure."""
    key = _key(watch["url"])
    previous = store.get_meta(conn, key, "")
    try:
        text = visible_text(get_text(watch["url"], timeout=45))
    except FetchError as exc:
        return "error", previous, str(exc)[:120]

    state = state_of(text, watch)
    title = ""
    match = re.search(r"^(.{0,110}?)\s+—\s+Google Careers", text)
    if match:
        title = match.group(1)
    if record and state != "error" and state != previous:
        store.set_meta(conn, key, state)
    return state, previous, title


def scan_watched(conn, record: bool = True, force: bool = False, verbose: bool = True) -> list[Job]:
    """Scan all enabled URLs from watched_urls.json.

    Returns a list of Job objects for postings that are newly open (or currently open if force=True).
    """
    watches = load()
    if not watches:
        if verbose:
            print("  no enabled URLs in watched_urls.json")
        return []

    hits: list[Job] = []
    for watch in watches:
        name = watch.get("name") or watch.get("url", "")
        url = watch["url"]
        state, previous, title_found = check(conn, watch, record=record)

        if verbose:
            status_desc = state
            if state == "error":
                status_desc = f"error ({title_found})"
            elif state == "open" and (previous != "open" or force):
                status_desc = "OPEN (ALERT!)"
            elif state == "open":
                status_desc = "open (already reported)"
            print(f"  • {name}: {status_desc}")

        if state == "open" and (previous != "open" or force):
            # Parse company and title
            company = watch.get("company", "")
            title = watch.get("title", "")
            if not company or not title:
                if " — " in name:
                    comp, _, tit = name.partition(" — ")
                    company = company or comp.strip()
                    title = title or tit.strip()
                elif " - " in name:
                    comp, _, tit = name.partition(" - ")
                    company = company or comp.strip()
                    title = title or tit.strip()
                else:
                    company = company or "Direct Posting"
                    title = title or title_found or name

            location = watch.get("location", "")
            track = watch.get("track") or classify_track(title) or "pm"
            region = watch.get("region") or location_region(location) or "us"

            job = Job(
                source="urlwatch",
                company=company,
                board="urlwatch",
                external_id=_key(url),
                title=title,
                location=location,
                url=url,
                posted_at=store.now(),
                track=track,
                region=region,
            )
            hits.append(job)

    return hits


def message(watch: dict, title: str) -> str:
    name = html.escape(watch.get("name") or watch["url"])
    lines = ["\U0001F6A8 <b>IT'S OPEN</b>", f"<b>{name}</b>"]
    if title:
        lines.append(html.escape(title))
    lines.append(f'\n<a href="{html.escape(watch["url"])}">Apply now</a>')
    return "\n".join(lines)
