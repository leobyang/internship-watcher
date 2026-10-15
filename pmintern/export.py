"""Export utilities: generate browsable markdown directories and GitHub Step Summaries."""
from __future__ import annotations

import sqlite3
import time
from collections import defaultdict
from pathlib import Path

REGION_NAMES = {
    "us": "United States",
    "ca": "Canada",
    "uk": "United Kingdom",
    "apac": "Asia-Pacific (APAC)",
    "remote": "Remote",
    "na": "North America (US/CA)",
    "foreign": "International",
    "unknown": "Other / Unspecified",
}

REGION_FLAGS = {
    "us": "🇺🇸",
    "ca": "🇨🇦",
    "uk": "🇬🇧",
    "apac": "🌏",
    "remote": "🌐",
    "na": "🇨🇦/🇺🇸",
    "foreign": "🌍",
    "unknown": "📍",
}

REGION_ORDER = ["us", "ca", "uk", "apac", "remote", "na", "foreign", "unknown"]


def job_date(job) -> str:
    """Return effective date YYYY-MM-DD from posted_at if present, else first_seen."""
    raw = job["posted_at"] or job["first_seen"] or ""
    return raw[:10] if len(raw) >= 10 else raw or "Recent"


def sort_newest_first(jobs: list) -> list:
    """Sort jobs newest date on top (descending), with company A-Z as secondary tiebreaker."""
    # Step 1: primary sort on company A-Z
    jobs.sort(key=lambda j: (j["company"] or "").lower())
    # Step 2: stable sort on date descending (newest on top)
    jobs.sort(key=lambda j: job_date(j), reverse=True)
    return jobs


def export_markdown(conn: sqlite3.Connection, output_path: str | Path = "JOBS.md") -> Path:
    """Generate a clean, searchable markdown directory sorted from newest postings on top."""
    path = Path(output_path)
    rows = conn.execute("""
        SELECT key, company, title, location, url, track, region, posted_at, first_seen
        FROM jobs
        WHERE closed_at = ''
    """).fetchall()

    by_track_region: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    all_jobs = list(rows)
    for r in all_jobs:
        t = (r["track"] or "pm").lower()
        reg = (r["region"] or "unknown").lower()
        by_track_region[t][reg].append(r)

    pm_total = sum(len(items) for items in by_track_region["pm"].values())
    swe_total = sum(len(items) for items in by_track_region["swe"].values())
    total_open = len(all_jobs)
    updated_str = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())

    # Sort all jobs for top "Fresh Drops" highlight
    fresh_all = sort_newest_first(list(all_jobs))[:30]

    lines = [
        "# 🎯 Active Internship Openings",
        "",
        "> **Auto-updated by GitHub Actions** • Tracks: Product Management (PM) & Software Engineering (SWE)  ",
        f"> **Total Live Openings:** {total_open:,} (PM: {pm_total:,} | SWE: {swe_total:,}) • *Updated: {updated_str}*  ",
        "> **Sorted Newest First**: All tables below display the most recently posted openings at the top.  ",
        "> Use `Cmd + F` or `Ctrl + F` to search companies, locations, or keywords.",
        "",
        "## 🧭 Quick Navigation",
        "",
        "- [📊 Regional Summary Table](#-regional-summary)",
        "- [🔥 Fresh Drops (Latest 30 Roles)](#-fresh-drops-latest-30-roles)",
        f"- [📋 Product Management Internships ({pm_total:,})](#-product-management-internships)",
        f"- [💻 Software Engineering Internships ({swe_total:,})](#-software-engineering-internships)",
        "  - [🇺🇸 United States SWE](#-united-states-swe)",
        "  - [🇨🇦 Canada SWE](#-canada-swe)",
        "  - [🇬🇧 United Kingdom SWE](#-united-kingdom-swe)",
        "  - [🌏 APAC SWE](#-asia-pacific-apac-swe)",
        "  - [🌐 Remote SWE](#-remote-swe)",
        "",
        "---",
        "",
        "## 📊 Regional Summary",
        "",
        "| Region | Flag | PM Internships | SWE Internships | Total Live |",
        "|:---|:---:|:---:|:---:|:---:|",
    ]

    for reg in REGION_ORDER:
        pm_cnt = len(by_track_region["pm"].get(reg, []))
        swe_cnt = len(by_track_region["swe"].get(reg, []))
        tot = pm_cnt + swe_cnt
        if tot > 0:
            name = REGION_NAMES.get(reg, reg.upper())
            flag = REGION_FLAGS.get(reg, "📍")
            lines.append(f"| {name} | {flag} | {pm_cnt:,} | {swe_cnt:,} | **{tot:,}** |")

    lines.append(f"| **Grand Total** | 🚀 | **{pm_total:,}** | **{swe_total:,}** | **{total_open:,}** |")
    lines.extend([
        "",
        "---",
        "",
        "## 🔥 Fresh Drops (Latest 30 Roles)",
        "",
        "*The 30 most recently posted openings across all tracks and regions:*",
        "",
        "| Date Posted | Track | Reg | Company | Title | Location | Direct Link |",
        "|:---:|:---:|:---:|:---|:---|:---|:---:|",
    ])

    for j in fresh_all:
        dt = job_date(j)
        t = (j["track"] or "pm").upper()
        reg = j["region"] or "unknown"
        flag = REGION_FLAGS.get(reg, "📍")
        comp = j["company"].replace("|", "\\|")
        title = j["title"].replace("|", "\\|")
        loc = (j["location"] or "Not specified").replace("|", "\\|")
        link = f"[Apply ↗]({j['url']})" if j["url"] else "—"
        lines.append(f"| `{dt}` | `{t}` | {flag} | **{comp}** | {title} | {loc} | {link} |")

    lines.extend([
        "",
        "---",
        "",
        "## 📋 Product Management Internships",
        "",
        f"*Total PM Openings: {pm_total:,} (Sorted Newest First)*",
        "",
        "| Date Posted | Region | Company | Title | Location | Direct Link |",
        "|:---:|:---:|:---|:---|:---|:---:|",
    ])

    pm_jobs = [r for reg_dict in by_track_region["pm"].values() for r in reg_dict]
    sort_newest_first(pm_jobs)

    for j in pm_jobs:
        dt = job_date(j)
        reg = j["region"] or "unknown"
        flag = REGION_FLAGS.get(reg, "📍")
        comp = j["company"].replace("|", "\\|")
        title = j["title"].replace("|", "\\|")
        loc = (j["location"] or "Not specified").replace("|", "\\|")
        link = f"[Apply ↗]({j['url']})" if j["url"] else "—"
        lines.append(f"| `{dt}` | {flag} | **{comp}** | {title} | {loc} | {link} |")

    lines.extend(["", "---", "", "## 💻 Software Engineering Internships", ""])

    for reg in REGION_ORDER:
        jobs = by_track_region["swe"].get(reg, [])
        if not jobs:
            continue
        flag = REGION_FLAGS.get(reg, "📍")
        name = REGION_NAMES.get(reg, reg.upper())
        sort_newest_first(jobs)

        lines.extend([
            f"### {flag} {name} SWE",
            "",
            f"*Openings: {len(jobs):,} (Sorted Newest First)*",
            "",
            "| Date Posted | Company | Title | Location | Direct Link |",
            "|:---:|:---|:---|:---|:---:|",
        ])
        for j in jobs:
            dt = job_date(j)
            comp = j["company"].replace("|", "\\|")
            title = j["title"].replace("|", "\\|")
            loc = (j["location"] or "Not specified").replace("|", "\\|")
            link = f"[Apply ↗]({j['url']})" if j["url"] else "—"
            lines.append(f"| `{dt}` | **{comp}** | {title} | {loc} | {link} |")
        lines.append("")

    content = "\n".join(lines) + "\n"
    path.write_text(content, encoding="utf-8")
    return path


def generate_summary_markdown(conn: sqlite3.Connection) -> str:
    """Generate a high-level markdown summary suitable for GITHUB_STEP_SUMMARY."""
    rows = conn.execute("""
        SELECT track, region, COUNT(*) n
        FROM jobs
        WHERE closed_at = ''
        GROUP BY track, region
    """).fetchall()

    tally: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in rows:
        tally[r["track"] or "pm"][r["region"] or "unknown"] = r["n"]

    pm_total = sum(tally["pm"].values())
    swe_total = sum(tally["swe"].values())
    total_open = pm_total + swe_total

    recent = conn.execute("""
        SELECT company, title, location, track, region, url, posted_at, first_seen
        FROM jobs
        WHERE closed_at = ''
        ORDER BY COALESCE(NULLIF(posted_at, ''), first_seen) DESC, first_seen DESC
        LIMIT 10
    """).fetchall()

    lines = [
        "## 🚀 Internship Watcher Run Summary",
        "",
        f"**Total Active Roles:** `{total_open:,}` | **PM:** `{pm_total:,}` | **SWE:** `{swe_total:,}`",
        "",
        "| Region | Flag | PM | SWE | Total |",
        "|:---|:---:|:---:|:---:|:---:|",
    ]

    for reg in REGION_ORDER:
        p = tally["pm"].get(reg, 0)
        s = tally["swe"].get(reg, 0)
        if p + s > 0:
            name = REGION_NAMES.get(reg, reg.upper())
            flag = REGION_FLAGS.get(reg, "📍")
            lines.append(f"| {name} | {flag} | {p:,} | {s:,} | **{p + s:,}** |")

    lines.extend([
        "",
        "### 🕒 Most Recently Added Openings",
        "",
        "| Date Posted | Track | Reg | Company | Title | Location | Apply |",
        "|:---:|:---:|:---:|:---|:---|:---|:---:|",
    ])

    for r in recent:
        dt = job_date(r)
        t = (r["track"] or "pm").upper()
        reg = r["region"] or "unknown"
        flag = REGION_FLAGS.get(reg, "📍")
        comp = r["company"].replace("|", "\\|")
        title = r["title"].replace("|", "\\|")
        loc = (r["location"] or "").replace("|", "\\|")
        link = f"[Apply ↗]({r['url']})" if r["url"] else "—"
        lines.append(f"| `{dt}` | `{t}` | {flag} | **{comp}** | {title} | {loc} | {link} |")

    lines.extend([
        "",
        "📁 Full directory sorted newest first is in [JOBS.md](JOBS.md).",
        "",
    ])
    return "\n".join(lines)


def export_json(conn: sqlite3.Connection, output_path: str | Path = "jobs.json") -> Path:
    """Export active jobs and tracker decisions to a compact JSON file for web hosting."""
    import json

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    rows = conn.execute("""
        SELECT key, source, company, board, external_id, title, location, url,
               track, region, posted_at, first_seen, last_seen, closed_at, department,
               status, status_at, notes
        FROM jobs
        WHERE closed_at = ''
        ORDER BY COALESCE(NULLIF(posted_at, ''), first_seen) DESC, first_seen DESC
    """).fetchall()

    tracker = {}
    tracker_by_url = {}
    tracker_file = Path("tracker.json")
    if tracker_file.exists():
        try:
            tracker = json.loads(tracker_file.read_text(encoding="utf-8"))
            for k, val in tracker.items():
                if isinstance(val, dict) and val.get("url"):
                    clean_u = val["url"].split("?")[0].rstrip("/").lower()
                    tracker_by_url[clean_u] = val
                    tracker_by_url[val["url"].strip()] = val
        except Exception:
            pass

    jobs_list = []
    for r in rows:
        u_raw = (r["url"] or "").strip()
        u_norm = u_raw.split("?")[0].rstrip("/").lower() if u_raw else ""
        t_info = tracker.get(r["key"]) or tracker_by_url.get(u_raw) or tracker_by_url.get(u_norm, {})

        db_status = r["status"] if "status" in r.keys() and r["status"] not in ("none", "", None) else ""
        final_status = t_info.get("status") or db_status or "new"
        if final_status == "none":
            final_status = "new"

        jobs_list.append({
            "key": r["key"],
            "source": r["source"] or "",
            "company": r["company"] or "",
            "board": r["board"] or "",
            "external_id": r["external_id"] or "",
            "title": r["title"] or "",
            "location": r["location"] or "",
            "url": r["url"] or "",
            "track": r["track"] or "pm",
            "region": r["region"] or "unknown",
            "posted_at": r["posted_at"] or "",
            "first_seen": r["first_seen"] or "",
            "last_seen": r["last_seen"] or "",
            "closed_at": r["closed_at"] or "",
            "department": r["department"] or "",
            "status": final_status,
            "status_at": t_info.get("status_at") or (r["status_at"] if "status_at" in r.keys() else "") or "",
            "notes": t_info.get("notes") or (r["notes"] if "notes" in r.keys() else "") or "",
        })

    payload = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total": len(jobs_list),
        "jobs": jobs_list,
    }

    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return path
