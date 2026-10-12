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


def export_markdown(conn: sqlite3.Connection, output_path: str | Path = "JOBS.md") -> Path:
    """Generate a clean, searchable markdown directory of all active internship openings."""
    path = Path(output_path)
    rows = conn.execute("""
        SELECT key, company, title, location, url, track, region, posted_at, first_seen
        FROM jobs
        WHERE closed_at = ''
        ORDER BY company COLLATE NOCASE ASC, title COLLATE NOCASE ASC
    """).fetchall()

    by_track_region: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        t = (r["track"] or "pm").lower()
        reg = (r["region"] or "unknown").lower()
        by_track_region[t][reg].append(r)

    pm_total = sum(len(items) for items in by_track_region["pm"].values())
    swe_total = sum(len(items) for items in by_track_region["swe"].values())
    total_open = len(rows)
    updated_str = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())

    lines = [
        "# 🎯 Active Internship Openings",
        "",
        "> **Auto-updated by GitHub Actions** • Tracks: Product Management (PM) & Software Engineering (SWE)  ",
        f"> **Total Live Openings:** {total_open:,} (PM: {pm_total:,} | SWE: {swe_total:,}) • *Updated: {updated_str}*  ",
        "> Use `Cmd + F` or `Ctrl + F` to search companies, locations, or keywords.",
        "",
        "## 🧭 Quick Navigation",
        "",
        "- [📊 Regional Summary Table](#-regional-summary)",
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
    lines.extend(["", "---", "", "## 📋 Product Management Internships", ""])

    pm_jobs = [r for reg_dict in by_track_region["pm"].values() for r in reg_dict]
    # Sort PM jobs by region priority then company
    pm_priority = {"ca": 0, "uk": 1, "apac": 2, "remote": 3, "us": 4, "na": 5, "unknown": 6}
    pm_jobs.sort(key=lambda j: (pm_priority.get(j["region"], 7), j["company"].lower()))

    lines.extend([
        f"*Total PM Openings: {len(pm_jobs):,}*",
        "",
        "| Region | Company | Title | Location | Direct Link |",
        "|:---:|:---|:---|:---|:---:|",
    ])
    for j in pm_jobs:
        reg = j["region"] or "unknown"
        flag = REGION_FLAGS.get(reg, "📍")
        comp = j["company"].replace("|", "\\|")
        title = j["title"].replace("|", "\\|")
        loc = (j["location"] or "Not specified").replace("|", "\\|")
        link = f"[Apply ↗]({j['url']})" if j["url"] else "—"
        lines.append(f"| {flag} | **{comp}** | {title} | {loc} | {link} |")

    lines.extend(["", "---", "", "## 💻 Software Engineering Internships", ""])

    for reg in REGION_ORDER:
        jobs = by_track_region["swe"].get(reg, [])
        if not jobs:
            continue
        flag = REGION_FLAGS.get(reg, "📍")
        name = REGION_NAMES.get(reg, reg.upper())
        anchor = f"{flag} {name} SWE".lower().replace(" ", "-").replace("(", "").replace(")", "").replace("/", "")
        lines.extend([
            f"### {flag} {name} SWE",
            "",
            f"*Openings: {len(jobs):,}*",
            "",
            "| Company | Title | Location | Direct Link |",
            "|:---|:---|:---|:---:|",
        ])
        for j in sorted(jobs, key=lambda x: (x["company"].lower(), x["title"].lower())):
            comp = j["company"].replace("|", "\\|")
            title = j["title"].replace("|", "\\|")
            loc = (j["location"] or "Not specified").replace("|", "\\|")
            link = f"[Apply ↗]({j['url']})" if j["url"] else "—"
            lines.append(f"| **{comp}** | {title} | {loc} | {link} |")
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
        SELECT company, title, location, track, region, url, first_seen
        FROM jobs
        WHERE closed_at = ''
        ORDER BY first_seen DESC
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
        "| Track | Reg | Company | Title | Location | Apply |",
        "|:---:|:---:|:---|:---|:---|:---:|",
    ])

    for r in recent:
        t = (r["track"] or "pm").upper()
        reg = r["region"] or "unknown"
        flag = REGION_FLAGS.get(reg, "📍")
        comp = r["company"].replace("|", "\\|")
        title = r["title"].replace("|", "\\|")
        loc = (r["location"] or "").replace("|", "\\|")
        link = f"[Apply ↗]({r['url']})" if r["url"] else "—"
        lines.append(f"| `{t}` | {flag} | **{comp}** | {title} | {loc} | {link} |")

    lines.extend([
        "",
        "📁 Full directory is committed to [JOBS.md](JOBS.md).",
        "",
    ])
    return "\n".join(lines)
