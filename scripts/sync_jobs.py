#!/usr/bin/env python3
"""Sync jobs from JOBS.md into SQLite database and web/public/jobs.json."""

import hashlib
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

from parse_md import parse_jobs_md

ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / "jobs.db"
TRACKER_PATH = ROOT_DIR / "tracker.json"
WEB_JSON_PATH = ROOT_DIR / "web" / "public" / "jobs.json"
OUT_JSON_PATH = ROOT_DIR / "web" / "out" / "jobs.json"

def get_job_key_from_url(url: str, company: str, title: str) -> str:
    # Greenhouse: https://job-boards.greenhouse.io/asteraearlycareer2027/jobs/4739769005
    gh_match = re.search(r'greenhouse\.io/([^/]+)/jobs/(\d+)', url)
    if gh_match:
        raw = f"greenhouse:{gh_match.group(1)}:{gh_match.group(2)}"
        return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]

    # Lever: https://jobs.lever.co/company/id
    lever_match = re.search(r'jobs\.lever\.co/([^/]+)/([a-zA-Z0-9-]+)', url)
    if lever_match:
        raw = f"lever:{lever_match.group(1)}:{lever_match.group(2)}"
        return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]

    # Ashby: https://jobs.ashbyhq.com/company/id
    ashby_match = re.search(r'jobs\.ashbyhq\.com/([^/]+)/([a-zA-Z0-9-]+)', url)
    if ashby_match:
        raw = f"ashby:{ashby_match.group(1)}:{ashby_match.group(2)}"
        return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]

    # Fallback deterministic key
    norm = f"{company}:{title}:{url}".lower()
    return hashlib.sha1(norm.encode('utf-8')).hexdigest()[:16]

def sync():
    md_path = ROOT_DIR / "JOBS.md"
    if not md_path.exists():
        print(f"Error: {md_path} not found")
        sys.exit(1)

    print(f"Parsing {md_path}...")
    parsed_jobs = parse_jobs_md(str(md_path))
    print(f"Found {len(parsed_jobs)} jobs in JOBS.md")

    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Query all existing jobs in DB by url
    c.execute("SELECT key, url, posted_at, first_seen, status, notes FROM jobs")
    existing_by_url = {}
    existing_by_key = {}
    for r in c.fetchall():
        if r["url"]:
            existing_by_url[r["url"].strip()] = dict(r)
        existing_by_key[r["key"]] = dict(r)

    print(f"Existing jobs in DB: {len(existing_by_key)} (unique URLs: {len(existing_by_url)})")

    # Load tracker
    tracker = {}
    if TRACKER_PATH.exists():
        try:
            tracker = json.loads(TRACKER_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print("Tracker read error:", e)

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    new_inserts = 0
    updated_records = 0

    final_jobs_list = []

    for item in parsed_jobs:
        url = item["url"].strip()
        comp = item["company"]
        title = item["title"]
        posted_dt = item["posted_at"]
        track = item["track"]
        region = item["region"]
        loc = item["location"]

        db_row = existing_by_url.get(url)
        if db_row:
            key = db_row["key"]
            first_seen = db_row["first_seen"] or (posted_dt + "T00:00:00Z" if posted_dt else now_iso)
            # Update posted_at if newer/better
            if posted_dt and (not db_row["posted_at"] or posted_dt > db_row["posted_at"][:10]):
                c.execute("UPDATE jobs SET posted_at = ?, track = ?, region = ?, closed_at = '' WHERE key = ?",
                          (posted_dt + "T00:00:00Z", track, region, key))
                updated_records += 1
            else:
                c.execute("UPDATE jobs SET closed_at = '' WHERE key = ?", (key,))
        else:
            key = get_job_key_from_url(url, comp, title)
            # Check if key already in DB
            if key in existing_by_key:
                first_seen = existing_by_key[key]["first_seen"] or now_iso
            else:
                first_seen = posted_dt + "T00:00:00Z" if posted_dt else now_iso
                # Insert into DB
                dupe_norm = re.sub(r'[^a-z0-9]+', '', f"{comp}{title}".lower())
                dupe_key = hashlib.sha1(dupe_norm.encode('utf-8')).hexdigest()[:16]
                
                # Deduce source
                source = 'external'
                board = comp.lower().replace(' ', '')
                ext_id = key
                if 'greenhouse.io' in url:
                    source = 'greenhouse'
                elif 'lever.co' in url:
                    source = 'lever'
                elif 'ashbyhq.com' in url:
                    source = 'ashby'
                elif 'myworkdayjobs.com' in url:
                    source = 'workday'

                c.execute("""
                    INSERT OR REPLACE INTO jobs
                    (key, source, company, board, external_id, title, location, url,
                     posted_at, first_seen, last_seen, closed_at, status, dupe_key, track, region)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'new', ?, ?, ?)
                """, (key, source, comp, board, ext_id, title, loc, url,
                      posted_dt + "T00:00:00Z" if posted_dt else "",
                      first_seen, now_iso, dupe_key, track, region))
                new_inserts += 1

        t_info = tracker.get(key, {})
        status = t_info.get("status", "new")
        if status == "none":
            status = "new"

        final_jobs_list.append({
            "key": key,
            "source": "web",
            "company": comp,
            "board": "",
            "external_id": key,
            "title": title,
            "location": loc,
            "url": url,
            "track": track,
            "region": region,
            "posted_at": posted_dt + "T00:00:00Z" if posted_dt else "",
            "first_seen": first_seen,
            "last_seen": now_iso,
            "closed_at": "",
            "department": "",
            "status": status,
            "status_at": t_info.get("status_at", ""),
            "notes": t_info.get("notes", ""),
        })

    conn.commit()
    conn.close()

    print(f"DB updated: {new_inserts} new jobs inserted, {updated_records} records updated.")

    # Sort final_jobs_list: newest posted_at / first_seen on top
    final_jobs_list.sort(key=lambda j: (j.get("posted_at") or j.get("first_seen") or ""), reverse=True)

    payload = {
        "updated_at": now_iso,
        "total": len(final_jobs_list),
        "jobs": final_jobs_list,
    }

    # Write to web/public/jobs.json
    WEB_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    WEB_JSON_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Exported {len(final_jobs_list)} jobs to {WEB_JSON_PATH}")

    # Write to web/out/jobs.json if web/out exists
    if OUT_JSON_PATH.parent.exists():
        OUT_JSON_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        print(f"Exported to {OUT_JSON_PATH}")

if __name__ == '__main__':
    sync()
