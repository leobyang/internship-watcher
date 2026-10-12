"""Scan every configured board, store what is new, and alert on it."""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from . import config, discord, store, telegram
from .config import COMPANIES_PATH
from .http import FetchError
from .match import DEFAULT_REGIONS, DEFAULT_TRACKS, location_region, matches, matches_watchlist
from .models import Job
from .sources import fetch

MAX_ALERTS_PER_CYCLE = 25   # beyond this, the rest go out as one digest
SEND_DELAY = 1.2            # seconds between sends


@dataclass
class ScanResult:
    new_jobs: list
    matched: int = 0
    all_matched: list = None
    scanned_boards: int = 0
    failed_boards: list = None
    closed: int = 0
    seeded: bool = False


def load_companies(path=COMPANIES_PATH, region: str | None = None) -> list[dict]:
    """Enabled boards, optionally filtered by region."""
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing")
    doc = json.loads(path.read_text(encoding="utf-8"))
    companies = [c for c in doc.get("companies", []) if c.get("enabled", True)]
    if region == "ca":
        companies = [c for c in companies if c.get("canada")]
    return companies


def load_watchlist(path=COMPANIES_PATH) -> list[dict]:
    """Per-company widening rules; see companies.json."""
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("watchlist", [])


def _scan_board(company: dict) -> tuple[dict, list[Job] | None, str]:
    try:
        jobs = fetch(company["source"], company["board"], company["name"])
        return company, jobs, ""
    except Exception as exc:  # noqa: BLE001
        return company, None, f"{type(exc).__name__}: {exc}"[:200]


def scan(conn, *, workers: int = 20, require_location: bool = True,
         verbose: bool = False, record: bool = True, only: str | None = None,
         region: str | None = None, tracks: set[str] | None = None,
         allowed_regions: set[str] | None = None) -> ScanResult:
    companies = load_companies(region=region)
    if only:
        needle = only.lower()
        companies = [c for c in companies if needle in c["name"].lower()]
        if not companies:
            raise ValueError(f"no tracked company matching {only!r}")

    active_tracks = tracks or config.get_tracks()
    active_regions = allowed_regions or config.get_regions()
    if region and region != "all":
        active_regions = {region.lower()}

    watchlist = load_watchlist()
    was_empty = store.stats(conn)["_total"] == 0
    failed: list[tuple[str, str]] = []
    all_matched: list[Job] = []
    seen_by_board: dict[tuple[str, str], set] = {}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for company, jobs, error in pool.map(_scan_board, companies):
            source, board = company["source"], company["board"]
            if jobs is None:
                failed.append((company["name"], error))
                store.record_board(conn, source, board, company["name"], False, error)
                if verbose:
                    print(f"  ! {company['name']}: {error}")
                continue
            store.record_board(conn, source, board, company["name"], True)
            hits = [
                j for j in jobs
                if matches(j, require_location=require_location, tracks=active_tracks, allowed_regions=active_regions)
                or matches_watchlist(j, watchlist, allowed_regions=active_regions)
            ]
            seen_by_board[(source, board)] = {j.key for j in hits}
            all_matched.extend(hits)
            if verbose and hits:
                for hit in hits:
                    print(f"  + {hit}")

    if not record:
        rows = conn.execute("SELECT key, dupe_key FROM jobs WHERE closed_at = ''").fetchall()
        known = {row["key"] for row in rows}
        known_dupes = {row["dupe_key"] for row in rows if row["dupe_key"]}
        preview, seen_dupes = [], set()
        for job in all_matched:
            if job.key in known or job.dupe_key in known_dupes or job.dupe_key in seen_dupes:
                continue
            seen_dupes.add(job.dupe_key)
            preview.append(job)
        return ScanResult(new_jobs=preview, all_matched=all_matched,
                          matched=len(all_matched),
                          scanned_boards=len(companies) - len(failed),
                          failed_boards=failed, closed=0, seeded=not known)

    new_jobs = store.record_seen(conn, all_matched)

    closed_keys = []
    if region:
        seen_by_board = {}
    for (source, board), live_keys in seen_by_board.items():
        for key in store.keys_for_board(conn, source, board) - live_keys:
            closed_keys.append(key)
    closed = store.mark_closed(conn, closed_keys)

    return ScanResult(new_jobs=new_jobs, all_matched=all_matched,
                      matched=len(all_matched),
                      scanned_boards=len(companies) - len(failed),
                      failed_boards=failed, closed=closed, seeded=was_empty)


def _sort_jobs_for_alert(jobs: list[Job]) -> list[Job]:
    """Sort non-US regions first so they stand out in notifications."""
    priority = {"ca": 0, "uk": 1, "apac": 2, "na": 3, "remote": 4, "us": 5}
    return sorted(jobs, key=lambda j: priority.get(getattr(j, "region", "unknown"), 6))


def notify(conn, bot: telegram.Telegram | None = None, result: ScanResult = None,
           dry_run: bool = False, digest: bool = False,
           discord_bot: discord.Discord | None = None) -> int:
    """Send alerts for new jobs via Discord and/or Telegram."""
    jobs = result.new_jobs
    if not jobs:
        return 0

    ordered = _sort_jobs_for_alert(jobs)
    sent_count = 0

    # 1. DISCORD DELIVERY
    if discord_bot:
        if result.seeded or digest:
            header = f"🚀 Tracker Started: {len(ordered)} Open Internships Found (PM & SWE)"
            if digest and not result.seeded:
                header = f"📬 {len(ordered)} New Internship Postings Added"
            if dry_run:
                print(f"[Discord dry-run] Digest of {len(ordered)} jobs")
            else:
                try:
                    discord_bot.send_digest(ordered, header=header)
                except Exception as exc:
                    print(f"  ! Discord digest failed: {exc}")
        else:
            for job in ordered[:MAX_ALERTS_PER_CYCLE]:
                if dry_run:
                    print(f"[Discord dry-run] Alert: {job}")
                else:
                    try:
                        res = discord_bot.send_job_alert(job)
                        msg_id = str(res.get("id", "")) if isinstance(res, dict) else ""
                        store.mark_notified(conn, job.key, msg_id or None)
                    except Exception as exc:
                        print(f"  ! Discord alert failed for {job}: {exc}")
                    time.sleep(SEND_DELAY)

            overflow = ordered[MAX_ALERTS_PER_CYCLE:]
            if overflow:
                if dry_run:
                    print(f"[Discord dry-run] Overflow digest: +{len(overflow)} more jobs")
                else:
                    try:
                        discord_bot.send_digest(overflow, header=f"📬 +{len(overflow)} More New Postings")
                    except Exception as exc:
                        print(f"  ! Discord overflow digest failed: {exc}")

    # 2. TELEGRAM DELIVERY
    if bot:
        if result.seeded or digest:
            header = (f"<b>Tracker started</b>\n{len(ordered)} open internships found. "
                      f"You will get an individual alert for each new one from now on.")
            if digest and not result.seeded:
                header = (f"<b>{len(ordered)} postings added</b>\nFrom newly added sources. "
                          f"Individual alerts resume for anything new after this.")
            text = _tg_digest(ordered, header=header)
            if dry_run:
                print(text)
            else:
                bot.send(text)
        else:
            for job in ordered[:MAX_ALERTS_PER_CYCLE]:
                text = telegram.job_message(job, getattr(job, "region", ""))
                markup = telegram.job_keyboard(job.key, job.url)
                if dry_run:
                    print(f"\n--- would send to Telegram ---\n{text}")
                else:
                    try:
                        res = bot.send(text, reply_markup=markup)
                        msg_id = res.get("message_id")
                        store.mark_notified(conn, job.key, msg_id)
                    except FetchError as exc:
                        print(f"  ! Telegram send failed for {job}: {exc}")
                    time.sleep(SEND_DELAY)

            overflow = ordered[MAX_ALERTS_PER_CYCLE:]
            if overflow:
                text = _tg_digest(overflow, header=f"<b>+{len(overflow)} more new postings</b>")
                if dry_run:
                    print(text)
                else:
                    bot.send(text)

    # Mark all notified if dry_run or digest
    if not dry_run and (result.seeded or digest):
        for job in ordered:
            store.mark_notified(conn, job.key, None)

    return len(ordered)


def _tg_digest(jobs: list[Job], header: str) -> str:
    lines = [header, ""]
    flags = {"ca": "🇨🇦 ", "uk": "🇬🇧 ", "apac": "🌏 ", "us": "🇺🇸 ", "remote": "🌐 "}
    for job in jobs[:40]:
        flag = flags.get(getattr(job, "region", ""), "")
        track_tag = f"[{job.track.upper()}] " if hasattr(job, "track") and job.track else ""
        label = telegram.esc(f"{track_tag}{job.company} - {job.title}")
        lines.append(f'- {flag}<a href="{telegram.esc(job.url)}">{label}</a>'
                     if job.url else f"- {flag}{label}")
    if len(jobs) > 40:
        lines.append(f"\n...and {len(jobs) - 40} more. Run: python3 cli.py list")
    return "\n".join(lines)


def process_callbacks(conn, bot: telegram.Telegram) -> int:
    """Apply Applied/Save/Ignore taps from Telegram to the tracker."""
    offset = int(store.get_meta(conn, "tg_offset", "0") or 0)
    try:
        updates = bot.get_updates(offset=offset)
    except FetchError as exc:
        print(f"  ! could not read Telegram updates: {exc}")
        return 0

    handled = 0
    for update in updates:
        offset = max(offset, update["update_id"] + 1)
        query = update.get("callback_query")
        if not query:
            continue
        data = query.get("data", "")
        bot.answer_callback(query["id"])
        if not data.startswith("s:"):
            continue
        _, status, key = (data.split(":", 2) + ["", ""])[:3]
        if status not in store.STATUSES or not store.get_job(conn, key):
            continue
        store.set_status(conn, key, status)
        row = store.get_job(conn, key)
        message = query.get("message") or {}
        if message.get("message_id"):
            bot.edit_markup(message["message_id"],
                            telegram.decided_keyboard(status, row["url"]))
        bot.answer_callback(query["id"], f"Marked {status}")
        handled += 1

    store.set_meta(conn, "tg_offset", offset)
    return handled
