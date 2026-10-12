# Internship Watcher (PM & SWE)

Polls 200+ public job sources and community feeds continuously for **Product Management (PM)** and **Software Engineering (SWE)** internships across **the US, Canada, UK, and APAC**, alerting you on **Discord** (or Telegram) the moment a role opens.

No third-party dependencies — built on Python 3.9+ standard library only.

---

## Highlights

- 🎯 **Dual Track Support**: Monitors **Product Management** (PM, APM, Product Intern) and **Software Engineering** (SWE, SDE, Frontend, Backend, Full Stack, AI/ML, Systems, Mobile, DevOps).
- 🌍 **Multi-Region Coverage**:
  - 🇺🇸 **United States**
  - 🇨🇦 **Canada**
  - 🇬🇧 **United Kingdom** (London, Edinburgh, Manchester, Cambridge, etc.)
  - 🌏 **APAC** (Singapore, Australia, New Zealand, India, Japan, South Korea, Hong Kong, Taiwan, Southeast Asia)
  - 🌐 **Remote** (Worldwide remote or regional remote)
- 💬 **Discord Integration**: Delivers rich embeds with role badges, country flags, company information, and direct "Apply" buttons. Also retains Telegram support.
- ⚡ **Zero Scraping**: Directly polls public Greenhouse, Lever, Ashby, Workday, Oracle HCM APIs and curated community feeds — runs in seconds without IP blocking.
- 📊 **Local Application Tracker**: Built-in SQLite database tracking statuses (`new`, `saved`, `applied`, `interview`, `offer`, `rejected`, `ignored`).

---

## Quick Setup (3 Minutes)

### 1. Configure `.env`

```bash
cp .env.example .env
```

### 2. Connect Discord (Recommended)

1. In your Discord server, right-click the channel where you want job alerts -> **Edit Channel**.
2. Select **Integrations** -> **Webhooks** -> **New Webhook**.
3. Name it `Internship Watcher` and click **Copy Webhook URL**.
4. In `.env`, paste the URL:
   ```env
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   ```

*(Optional: If you prefer Telegram, message [@BotFather](https://t.me/BotFather) for a bot token, set `TELEGRAM_BOT_TOKEN`, and run `python3 cli.py chatid`.)*

### 3. Test Connection

```bash
python3 cli.py test
```

You will receive a test alert in your Discord channel (or Telegram)!

### 4. Run First Scan

```bash
python3 cli.py scan
```

The first run sends a digest of all open roles. After that, new postings trigger individual alerts immediately.

---

## Filters & Customization

You can control what you track via `.env` or on the fly with CLI flags:

### In `.env`:
```env
# Tracks: pm, swe (default: pm,swe)
TRACKS=pm,swe

# Regions: us, ca, uk, apac, remote (default: all)
REGIONS=us,ca,uk,apac,remote
```

### Via CLI:
```bash
# Scan only Software Engineering internships in the UK
python3 cli.py scan --track swe --region uk

# Scan only PM internships in Canada
python3 cli.py scan --track pm --region ca

# Scan all roles in APAC
python3 cli.py scan --region apac

# Dry run (prints matches to terminal without sending alerts)
python3 cli.py scan --dry-run
```

---

## 📁 Live Directory: `JOBS.md`

All live internship openings are automatically exported to **[`JOBS.md`](JOBS.md)**.
- Organized by track (**PM** vs **SWE**) and region (🇺🇸 US, 🇨🇦 Canada, 🇬🇧 UK, 🌏 APAC, 🌐 Remote).
- Searchable directly in your browser (`Cmd + F` or `Ctrl + F`) with direct "Apply Now" links.
- Automatically updated on GitHub by GitHub Actions after every hourly scan.

---

## Application Tracker (CLI)

```bash
# View open tracked internships in your terminal
python3 cli.py list

# Filter list by role track or region
python3 cli.py list --track swe --region uk
python3 cli.py list --track pm --region ca

# Filter by application status
python3 cli.py list --status applied
python3 cli.py list --status saved

# Update status (accepts unique ID prefix)
python3 cli.py status 5ff0 applied
python3 cli.py status 5ff0 interview
python3 cli.py note   5ff0 "Referral from Alice"
python3 cli.py show   5ff0 --open   # inspect details and open URL in browser

# Funnel and regional summary
python3 cli.py stats
```

Statuses: `new`, `saved`, `applied`, `interview`, `offer`, `rejected`, `ignored`.

---

## Running Continuously

### On macOS (Background Daemon)
Run the watcher every 15 minutes automatically:
```bash
./scripts/install-launchd.sh
```
To stop:
```bash
launchctl bootout gui/$(id -u)/com.pmintern.watcher
```

### In Terminal
```bash
python3 cli.py watch
# Or watch specific tracks/regions
python3 cli.py watch --track swe --region uk --every 15
```

### In GitHub Actions
Push to a **private** GitHub repository and add `DISCORD_WEBHOOK_URL` to repository secrets. `.github/workflows/watch.yml` will poll on a schedule.

---

## Adding & Managing Companies

`companies.json` contains 200+ public company boards.

```bash
# Add a new company board (verifies API before saving)
python3 cli.py add "Company Name" greenhouse their-board-token
python3 cli.py add "Startup Name" ashby their-board-token

# Check health of all boards
python3 cli.py health

# Verify all boards and prune dead ones
python3 cli.py verify --prune
```
