#!/usr/bin/env python3
"""Internship watcher + application tracker (PM & SWE in US, Canada, UK, and APAC).

    python3 cli.py scan              one scan, alert on anything new
    python3 cli.py watch             scan forever on POLL_MINUTES
    python3 cli.py list              show tracked postings
    python3 cli.py status <id> applied
    python3 cli.py stats
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import webbrowser

from pmintern import config, discord, export, store, telegram, urlwatch
from pmintern.config import COMPANIES_PATH
from pmintern.http import FetchError
from pmintern.match import location_region
from pmintern.runner import ScanResult, notify, process_callbacks, scan
from pmintern.sources import fetch


def get_notifiers(force_service: str | None = None) -> tuple[discord.Discord | None, telegram.Telegram | None]:
    """Return active (discord_client, telegram_client) based on .env and CLI flags."""
    service = force_service or config.get_notifier()
    discord_client = None
    telegram_client = None

    if service in ("discord", "both"):
        webhook = config.get("DISCORD_WEBHOOK_URL")
        bot_token = config.get("DISCORD_BOT_TOKEN")
        channel_id = config.get("DISCORD_CHANNEL_ID")
        if webhook or (bot_token and channel_id):
            discord_client = discord.Discord(webhook, bot_token, channel_id)

    if service in ("telegram", "both"):
        tg_token = config.get("TELEGRAM_BOT_TOKEN")
        tg_chat = config.get("TELEGRAM_CHAT_ID")
        if tg_token and tg_chat:
            telegram_client = telegram.Telegram(tg_token, tg_chat)

    return discord_client, telegram_client


def bot_from_env(require_chat: bool = True) -> telegram.Telegram:
    token = config.get("TELEGRAM_BOT_TOKEN")
    chat = config.get("TELEGRAM_CHAT_ID")
    if not token:
        sys.exit("TELEGRAM_BOT_TOKEN is not set in .env")
    if require_chat and not chat:
        sys.exit("TELEGRAM_CHAT_ID is not set in .env")
    return telegram.Telegram(token, chat)


def discord_from_env() -> discord.Discord:
    webhook = config.get("DISCORD_WEBHOOK_URL")
    bot_token = config.get("DISCORD_BOT_TOKEN")
    channel_id = config.get("DISCORD_CHANNEL_ID")
    if not webhook and not (bot_token and channel_id):
        sys.exit("Discord is not configured. Set DISCORD_WEBHOOK_URL (or DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID) in .env")
    return discord.Discord(webhook, bot_token, channel_id)


def resolve_key(conn, prefix: str) -> str:
    """Accept a unique key prefix so you can type 4-6 characters."""
    rows = conn.execute(
        "SELECT key, company, title FROM jobs WHERE key LIKE ?", (prefix + "%",)
    ).fetchall()
    if not rows:
        sys.exit(f"no tracked posting starts with {prefix!r}")
    if len(rows) > 1:
        print(f"{prefix!r} is ambiguous:")
        for row in rows[:10]:
            print(f"  {row['key']}  {row['company']} - {row['title']}")
        sys.exit(1)
    return rows[0]["key"]


# --- commands --------------------------------------------------------------

def cmd_scan(args) -> None:
    conn = store.connect()
    dry = args.dry_run or config.get_bool("DRY_RUN")
    started = time.time()

    force_service = None
    if getattr(args, "discord", False):
        force_service = "discord"
    elif getattr(args, "telegram", False):
        force_service = "telegram"

    discord_client, tg_client = get_notifiers(force_service)

    # Process pending Telegram callback taps if active
    if tg_client and not dry:
        try:
            store.import_tracker(conn)
            acted = process_callbacks(conn, tg_client)
            if acted:
                print(f"applied {acted} Telegram button tap(s)")
        except FetchError as exc:
            print(f"  ! could not read Telegram updates: {exc}")

    # Parse tracks
    tracks = None
    if args.track:
        if args.track.lower() == "all":
            tracks = {"pm", "swe"}
        else:
            tracks = {t.strip().lower() for t in args.track.split(",")}

    # Parse regions
    allowed_regions = None
    if args.region:
        if args.region.lower() == "all":
            allowed_regions = {"us", "ca", "na", "uk", "apac", "remote", "unknown", "foreign"}
        else:
            allowed_regions = {r.strip().lower() for r in args.region.split(",")}

    result = scan(conn, require_location=not args.any_location,
                  verbose=args.verbose, record=not dry, only=args.only,
                  tracks=tracks, allowed_regions=allowed_regions)

    # Regional & track tally of matches
    t_counts: dict[str, int] = {}
    r_counts: dict[str, int] = {}
    for j in result.all_matched:
        t = getattr(j, "track", "pm") or "pm"
        r = getattr(j, "region", "unknown") or "unknown"
        t_counts[t] = t_counts.get(t, 0) + 1
        r_counts[r] = r_counts.get(r, 0) + 1

    track_summary = f"PM: {t_counts.get('pm', 0)}, SWE: {t_counts.get('swe', 0)}"
    region_summary = f"US: {r_counts.get('us', 0)}, CA: {r_counts.get('ca', 0)}, UK: {r_counts.get('uk', 0)}, APAC: {r_counts.get('apac', 0)}"

    print(f"scanned {result.scanned_boards} boards in {time.time()-started:.0f}s | "
          f"{result.matched} matching live ({track_summary} | {region_summary}) | {len(result.new_jobs)} new"
          + (f" | {result.closed} closed" if result.closed else ""))

    if result.failed_boards and args.verbose:
        for name, err in result.failed_boards:
            print(f"  ! {name}: {err}")
    elif result.failed_boards:
        groups: dict[str, list[str]] = {}
        for name, err in result.failed_boards:
            groups.setdefault(err.split(" for ")[0][:70], []).append(name)
        print(f"  {len(result.failed_boards)} boards unreachable:")
        for err, names in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            print(f"    {len(names):>3}x {err}: {', '.join(names[:6])}"
                  + (" ..." if len(names) > 6 else ""))

    if result.new_jobs:
        if dry:
            notify(conn, bot=tg_client, result=result, dry_run=True, digest=args.digest, discord_bot=discord_client)
            print(f"\n[dry run] {len(result.new_jobs)} alert(s) not sent")
        else:
            if not discord_client and not tg_client:
                print("\n[!] No notification service configured! Alerts were not sent.")
                print("    Configure DISCORD_WEBHOOK_URL or TELEGRAM_BOT_TOKEN in .env (or run: python3 cli.py setup)")
            else:
                sent = notify(conn, bot=tg_client, result=result, digest=args.digest, discord_bot=discord_client)
                destinations = []
                if discord_client:
                    destinations.append("Discord")
                if tg_client:
                    destinations.append("Telegram")
                print(f"sent {sent} alert(s) to {', '.join(destinations)}")

    if not dry and store.export_tracker(conn):
        print("tracker.json updated")


def cmd_watch(args) -> None:
    minutes = args.every or config.get_int("POLL_MINUTES", 15)
    conn = store.connect()
    dry = args.dry_run or config.get_bool("DRY_RUN")
    discord_client, tg_client = get_notifiers()

    tracks = {args.track.lower()} if args.track and args.track != "all" else None
    regions = {args.region.lower()} if args.region and args.region != "all" else None

    destinations = []
    if discord_client:
        destinations.append("Discord")
    if tg_client:
        destinations.append("Telegram")
    dest_str = f" to {', '.join(destinations)}" if destinations else " (no notification service configured)"

    print(f"watching {len(json.loads(COMPANIES_PATH.read_text())['companies'])} boards "
          f"every {minutes} min{dest_str}. Ctrl-C to stop.")

    while True:
        try:
            result = scan(conn, require_location=not args.any_location, only=args.only,
                          tracks=tracks, allowed_regions=regions)
            stamp = time.strftime("%H:%M")
            line = (f"[{stamp}] {result.matched} live | {len(result.new_jobs)} new"
                    + (f" | {result.closed} closed" if result.closed else ""))
            if result.new_jobs:
                sent = notify(conn, bot=tg_client, result=result, dry_run=dry, discord_bot=discord_client)
                line += f" | {sent} alerted"
            if tg_client:
                acted = process_callbacks(conn, tg_client)
                if acted:
                    line += f" | {acted} triaged"
            print(line, flush=True)
        except KeyboardInterrupt:
            print("\nstopped.")
            return
        except Exception as exc:
            print(f"[{time.strftime('%H:%M')}] scan error: {type(exc).__name__}: {exc}", flush=True)
        try:
            time.sleep(minutes * 60)
        except KeyboardInterrupt:
            print("\nstopped.")
            return


def cmd_list(args) -> None:
    conn = store.connect()
    statuses = args.status.split(",") if args.status else None
    rows = store.find_jobs(conn, status=statuses, company=args.company,
                           track=args.track, region=args.region,
                           include_closed=args.all, limit=args.limit)
    if not rows:
        print("nothing tracked yet — run: python3 cli.py scan")
        return

    flags = {"us": "🇺🇸", "ca": "🇨🇦", "uk": "🇬🇧", "apac": "🌏", "remote": "🌐", "na": "🇨🇦/🇺🇸"}
    print(f"{'id':<8} {'posted':<11} {'track':<6} {'reg':<5} {'status':<10} {'company':<22} {'title':<38} location")
    print("-" * 125)
    for row in rows:
        closed = " (closed)" if row["closed_at"] else ""
        track = row["track"].upper() if "track" in row.keys() and row["track"] else "PM"
        reg = row["region"] if "region" in row.keys() and row["region"] else "us"
        flag = flags.get(reg, "📍")
        raw_dt = row["posted_at"] or row["first_seen"] or ""
        dt = raw_dt[:10] if len(raw_dt) >= 10 else raw_dt
        print(f"{row['key'][:8]:<8} {dt:<11} {track:<6} {flag:<5} {row['status']:<10} {row['company'][:21]:<22} "
              f"{row['title'][:37]:<38} {row['location'][:20]}{closed}")
    print(f"\n{len(rows)} shown. Mark one: python3 cli.py status <id> applied")


def cmd_export_md(args) -> None:
    conn = store.connect()
    path = getattr(args, "output", None) or "JOBS.md"
    written = export.export_markdown(conn, path)
    print(f"exported active postings to {written}")


def cmd_summary(args) -> None:
    conn = store.connect()
    print(export.generate_summary_markdown(conn))


def cmd_web(args) -> None:
    """Launch the Next.js keyboard-driven web application."""
    import subprocess
    from pathlib import Path
    port = getattr(args, "port", 3000)
    web_dir = Path(__file__).parent / "web"
    if not web_dir.exists():
        sys.exit("web directory not found.")
    print(f"🚀 Starting Leo's Internship Tracker on http://localhost:{port}...")
    import webbrowser
    webbrowser.open(f"http://localhost:{port}")
    try:
        subprocess.run(["npm", "run", "dev", "--", "-p", str(port)], cwd=str(web_dir), check=True)
    except KeyboardInterrupt:
        print("\nWeb app stopped.")


def cmd_status(args) -> None:
    conn = store.connect()
    key = resolve_key(conn, args.id)
    try:
        store.set_status(conn, key, args.new_status)
    except ValueError as exc:
        sys.exit(str(exc))
    row = store.get_job(conn, key)
    print(f"{row['company']} — {row['title']} -> {args.new_status}")


def cmd_note(args) -> None:
    conn = store.connect()
    key = resolve_key(conn, args.id)
    store.set_notes(conn, key, args.text)
    print("noted.")


def cmd_show(args) -> None:
    conn = store.connect()
    row = store.get_job(conn, resolve_key(conn, args.id))
    for field in ("company", "title", "track", "region", "location", "status", "url",
                  "posted_at", "first_seen", "status_at", "closed_at", "source", "notes"):
        if field in row.keys() and row[field]:
            print(f"{field:<11} {row[field]}")
    if args.open and row["url"]:
        webbrowser.open(row["url"])


def cmd_stats(args) -> None:
    conn = store.connect()
    data = store.stats(conn)
    total, open_n = data.pop("_total"), data.pop("_open")
    by_track = data.pop("_by_track", {})
    by_region = data.pop("_by_region", {})

    if not total:
        print("nothing tracked yet — run: python3 cli.py scan")
        return

    print(f"📊 {total} postings tracked ({open_n} currently open)\n")

    print("Role Tracks (open):")
    for t, n in sorted(by_track.items()):
        icon = "💻" if t == "swe" else "📋"
        print(f"  {icon} {t.upper():<6} {n}")

    print("\nRegions (open):")
    flags = {"us": "🇺🇸 US", "ca": "🇨🇦 Canada", "uk": "🇬🇧 UK", "apac": "🌏 APAC", "remote": "🌐 Remote", "na": "🇨🇦/🇺🇸 NA"}
    for r, n in sorted(by_region.items()):
        label = flags.get(r, f"📍 {r.upper()}")
        print(f"  {label:<16} {n}")

    print("\nFunnel Status:")
    for status in store.STATUSES:
        if data.get(status):
            print(f"  {status:<12} {data[status]}")

    applied = sum(data.get(s, 0) for s in ("applied", "interview", "offer", "rejected"))
    if applied:
        print(f"\n  applied to {applied} of {total} seen ({100*applied/total:.0f}%)")


def cmd_health(args) -> None:
    conn = store.connect()
    rows = conn.execute(
        "SELECT * FROM board_health ORDER BY fails DESC, company"
    ).fetchall()
    broken = [r for r in rows if r["fails"] > 0]
    if not broken:
        print(f"all {len(rows)} boards healthy")
        return
    print(f"{len(broken)} board(s) failing:\n")
    for row in broken:
        print(f"  {row['fails']:>3}x  {row['company'] or row['board']:<24} "
              f"{row['source']:<11} {row['last_error'][:60]}")
    print("\nDrop one with: python3 cli.py disable <board>")


def cmd_verify(args) -> None:
    from concurrent.futures import ThreadPoolExecutor
    doc = json.loads(COMPANIES_PATH.read_text(encoding="utf-8"))
    companies = doc["companies"]

    def probe(company):
        try:
            return company, len(fetch(company["source"], company["board"], company["name"])), ""
        except Exception as exc:
            return company, -1, str(exc)[:70]

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(probe, companies))

    dead = [(c, e) for c, n, e in results if n < 0]
    empty = [c for c, n, _ in results if n == 0]
    print(f"{len(results) - len(dead)}/{len(results)} boards responded"
          + (f", {len(empty)} returned zero postings" if empty else ""))
    for company, err in dead:
        print(f"  ! {company['name']} ({company['source']}:{company['board']}): {err}")
    if args.prune and dead:
        dead_keys = {(c["source"], c["board"]) for c, _ in dead}
        doc["companies"] = [c for c in companies if (c["source"], c["board"]) not in dead_keys]
        COMPANIES_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"pruned {len(dead)} dead board(s)")


def cmd_add(args) -> None:
    doc = json.loads(COMPANIES_PATH.read_text(encoding="utf-8"))
    if any(c["source"] == args.source and c["board"] == args.board for c in doc["companies"]):
        sys.exit(f"{args.source}:{args.board} is already in companies.json")
    try:
        jobs = fetch(args.source, args.board, args.name)
    except Exception as exc:
        sys.exit(f"could not read that board: {exc}")
    doc["companies"].append({"name": args.name, "source": args.source,
                             "board": args.board, "enabled": True})
    doc["companies"].sort(key=lambda c: c["name"].lower())
    COMPANIES_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"added {args.name} ({args.source}:{args.board}) — {len(jobs)} postings on that board")


def cmd_disable(args) -> None:
    doc = json.loads(COMPANIES_PATH.read_text(encoding="utf-8"))
    hits = [c for c in doc["companies"]
            if args.board.lower() in (c["board"].lower(), c["name"].lower())]
    if not hits:
        sys.exit(f"no company matching {args.board!r}")
    for company in hits:
        company["enabled"] = False
        print(f"disabled {company['name']}")
    COMPANIES_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def cmd_send(args) -> None:
    conn = store.connect()
    discord_client, tg_client = get_notifiers()
    result = scan(conn, record=False, only=args.company)
    jobs = result.all_matched or []

    if args.region:
        jobs = [j for j in jobs if getattr(j, "region", "") == args.region.lower()]
    if args.track:
        jobs = [j for j in jobs if getattr(j, "track", "") == args.track.lower()]
    if args.company:
        jobs = [j for j in jobs if args.company.lower() in j.company.lower()]

    seen, unique = set(), []
    for j in jobs:
        if j.dupe_key not in seen:
            seen.add(j.dupe_key)
            unique.append(j)

    print(f"pushing {len(unique)} postings...")
    res = ScanResult(new_jobs=unique, all_matched=unique, matched=len(unique), scanned_boards=1, seeded=False)
    notify(conn, bot=tg_client, result=res, dry_run=args.dry_run, discord_bot=discord_client)


def cmd_urlwatch(args) -> None:
    conn = store.connect()
    discord_client, tg_client = get_notifiers()
    dry = args.dry_run or config.get_bool("DRY_RUN")
    force = getattr(args, "force", False)
    verbose = not getattr(args, "quiet", False)
    print("watching tracked URLs...")
    while True:
        hits = urlwatch.scan_watched(conn, record=not dry, force=force, verbose=verbose)
        for job in hits:
            print(f"FOUND: {job}")
            if not dry:
                store.record_seen(conn, [job])
                if discord_client:
                    discord_client.send_job_alert(job)
                if tg_client:
                    tg_client.send(f"🚨 <b>URL WATCH HIT:</b>\n\n{telegram.job_message(job)}",
                                   reply_markup=telegram.job_keyboard(job.key, job.url))
        if not args.loop:
            break
        time.sleep(max(30, int(args.loop * 60)))


def cmd_test(args) -> None:
    """Send a test message to Discord and/or Telegram."""
    discord_client, tg_client = get_notifiers()
    tested = False

    if discord_client:
        sample_embed = {
            "title": "🧪 Test Notification: Internship Watcher",
            "description": "Discord notifications are working perfectly! You will receive alerts for PM & SWE internships across US, Canada, UK, and APAC here.",
            "color": 0x10B981,
            "fields": [
                {"name": "🎯 Roles Covered", "value": "📋 Product Management\n💻 Software Engineering", "inline": True},
                {"name": "🌍 Regions Covered", "value": "🇺🇸 US | 🇨🇦 Canada\n🇬🇧 UK | 🌏 APAC", "inline": True},
            ],
            "footer": {"text": "Internship Watcher • Setup Verified"},
        }
        try:
            discord_client.send_payload({"username": "Internship Watcher", "embeds": [sample_embed]})
            print("✅ Discord test alert sent successfully! Check your Discord channel.")
            tested = True
        except Exception as exc:
            print(f"❌ Discord test failed: {exc}")

    if tg_client:
        try:
            tg_client.send("<b>🧪 Test Notification: Internship Watcher</b>\n"
                           "Telegram alerts are working! Alerts for PM & SWE internships will arrive here.")
            print("✅ Telegram test alert sent successfully! Check your Telegram chat.")
            tested = True
        except Exception as exc:
            print(f"❌ Telegram test failed: {exc}")

    if not tested:
        print("No notification credentials found in .env.")
        print("Set DISCORD_WEBHOOK_URL or run: python3 cli.py setup")


def cmd_setup(args) -> None:
    """Guided setup for Discord and Telegram."""
    print("=== Internship Watcher Setup ===\n")
    print("Preferred Notification Service:")
    print("1. Discord Webhook (Instant, 10-second setup, rich embeds)")
    print("2. Telegram Bot (@BotFather)")
    print("3. Both Discord and Telegram\n")

    current_wh = config.get("DISCORD_WEBHOOK_URL")
    if current_wh:
        print(f"Current Discord Webhook: {current_wh[:40]}...")
    else:
        print("Discord Webhook is not configured yet.")
        print("To create one in Discord:")
        print("  1. In your Discord server, right click your desired alerts channel -> Edit Channel")
        print("  2. Go to 'Integrations' -> 'Webhooks' -> 'New Webhook'")
        print("  3. Name it 'Internship Watcher' and click 'Copy Webhook URL'")
        print("  4. Paste it into .env as: DISCORD_WEBHOOK_URL=<url>")

    print("\nNext steps:")
    print("  python3 cli.py test          verify your notifications")
    print("  python3 cli.py scan          perform your first scan")
    print("  python3 cli.py watch         run continuously")


def cmd_chatid(args) -> None:
    bot = bot_from_env(require_chat=False)
    info = bot.me()
    print(f"bot: @{info.get('username')}")
    updates = bot.get_updates()
    chats = {}
    for update in updates:
        msg = update.get("message") or (update.get("callback_query") or {}).get("message") or {}
        chat = msg.get("chat") or {}
        if chat.get("id"):
            chats[chat["id"]] = chat.get("username") or chat.get("title") or chat.get("first_name", "")
    if not chats:
        print("\nNo messages seen yet. Open Telegram, send your bot any message,\n"
              f"then run this again. (Find it at https://t.me/{info.get('username')})")
        return
    print("\nchat id(s) found — put one in .env as TELEGRAM_CHAT_ID:")
    for chat_id, name in chats.items():
        print(f"  {chat_id}   {name}")


def cmd_triage(args) -> None:
    conn = store.connect()
    bot = bot_from_env()
    print(f"applied {process_callbacks(conn, bot)} button tap(s)")


# --- argument parsing ------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cli.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("scan", help="one scan; alert on new postings")
    p.add_argument("--dry-run", action="store_true", help="print alerts instead of sending")
    p.add_argument("--verbose", "-v", action="store_true")
    p.add_argument("--any-location", action="store_true", help="do not filter location")
    p.add_argument("--digest", action="store_true",
                   help="send one summary message instead of one alert per posting")
    p.add_argument("--only", metavar="COMPANY",
                   help="scan just one company (fast, for testing or watching a known drop)")
    p.add_argument("--track", choices=["pm", "swe", "all"],
                   help="filter roles: pm, swe, or all (default: both)")
    p.add_argument("--region",
                   help="filter region: us, ca, uk, apac, remote, or all")
    p.add_argument("--discord", action="store_true", help="force send to Discord")
    p.add_argument("--telegram", action="store_true", help="force send to Telegram")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("watch", help="scan on a loop")
    p.add_argument("--every", type=int, metavar="MIN", help="minutes between scans")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--any-location", action="store_true")
    p.add_argument("--only", metavar="COMPANY", help="watch just one company")
    p.add_argument("--track", choices=["pm", "swe", "all"], help="filter roles")
    p.add_argument("--region", help="filter region: us, ca, uk, apac, or all")
    p.set_defaults(func=cmd_watch)

    p = sub.add_parser("send", help="push matching live postings now")
    p.add_argument("--track", choices=["pm", "swe"])
    p.add_argument("--region", help="us, ca, uk, apac")
    p.add_argument("--company", help="only this company")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_send)

    p = sub.add_parser("list", help="show tracked postings")
    p.add_argument("--status", help="comma-separated: new,saved,applied,interview,offer,rejected,ignored")
    p.add_argument("--track", choices=["pm", "swe"], help="filter by track")
    p.add_argument("--region", help="filter by region (us, ca, uk, apac, remote)")
    p.add_argument("--company")
    p.add_argument("--all", action="store_true", help="include closed postings")
    p.add_argument("--limit", type=int, default=100)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("status", help="set a posting's status")
    p.add_argument("id")
    p.add_argument("new_status", choices=store.STATUSES)
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("note", help="attach a note to a posting")
    p.add_argument("id"); p.add_argument("text")
    p.set_defaults(func=cmd_note)

    p = sub.add_parser("show", help="full detail for one posting")
    p.add_argument("id"); p.add_argument("--open", action="store_true", help="open in browser")
    p.set_defaults(func=cmd_show)

    sub.add_parser("stats", help="application funnel & regional summary").set_defaults(func=cmd_stats)
    p = sub.add_parser("export-md", help="generate browsable JOBS.md markdown directory")
    p.add_argument("output", nargs="?", default="JOBS.md", help="output file path (default: JOBS.md)")
    p.set_defaults(func=cmd_export_md)

    sub.add_parser("summary", help="output markdown run summary for GitHub Actions or CLI").set_defaults(func=cmd_summary)
    p = sub.add_parser("web", help="launch Next.js keyboard-driven web application")
    p.add_argument("--port", "-p", type=int, default=3000, help="port to run web app (default: 3000)")
    p.set_defaults(func=cmd_web)
    sub.add_parser("health", help="which boards are failing").set_defaults(func=cmd_health)

    p = sub.add_parser("verify", help="check every board still responds")
    p.add_argument("--prune", action="store_true", help="delete dead boards from companies.json")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("add", help="add a company board")
    p.add_argument("name"); p.add_argument("source", choices=["greenhouse", "lever", "ashby"])
    p.add_argument("board")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("disable", help="stop polling a company")
    p.add_argument("board")
    p.set_defaults(func=cmd_disable)

    p = sub.add_parser("setup", help="guided setup for Discord and Telegram")
    p.set_defaults(func=cmd_setup)

    p = sub.add_parser("urlwatch", help="watch individual job URLs and alert when they open")
    p.add_argument("--loop", type=float, metavar="MIN", help="keep checking every MIN minutes")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="alert even if already reported open")
    p.add_argument("--quiet", "-q", action="store_true", help="suppress per-URL status lines")
    p.set_defaults(func=cmd_urlwatch)

    sub.add_parser("chatid", help="find your Telegram chat id").set_defaults(func=cmd_chatid)
    sub.add_parser("test", help="send a test alert (Discord or Telegram)").set_defaults(func=cmd_test)
    sub.add_parser("triage", help="pull pending button taps from Telegram").set_defaults(func=cmd_triage)
    return parser


def main() -> None:
    config.load_env()
    args = build_parser().parse_args()
    try:
        args.func(args)
    except KeyboardInterrupt:
        print("\ninterrupted.")
    except FetchError as exc:
        sys.exit(f"network error: {exc}")


if __name__ == "__main__":
    main()
