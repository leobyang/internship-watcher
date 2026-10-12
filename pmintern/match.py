"""Decide whether a posting is an internship for PM or SWE in US, Canada, UK, or APAC.

Role tracks:
- PM: Product Management (APM, PM, Product Intern, etc.)
- SWE: Software Engineering (SWE, SDE, Frontend, Backend, Full Stack, ML/AI, Mobile, Systems, DevOps, etc.)

Regions:
- US: United States
- CA: Canada
- UK: United Kingdom (London, England, Scotland, etc.)
- APAC: Asia-Pacific (Singapore, Australia, New Zealand, India, Japan, South Korea, Hong Kong, Taiwan, SE Asia)
- Remote: Worldwide / unstated remote
"""
from __future__ import annotations

import re

# --- title: is this product management? ------------------------------------

STRONG_PM = (
    r"\bproduct manage(?:r|ment|rs)\b",
    r"\bassociate product manager\b",
    r"\bproduct owner\b",
    r"\bapm\b",
    r"\bpm\b",
    r"\btpm\b",
)

SOFT_PM = (
    r"\bproduct intern(?:ship)?\b",
    r"\bproduct co-?op\b",
)

PRODUCT_ADJACENT = (
    r"\bprogram manage(?:r|ment)\b",
    r"\btechnical program manager\b",
    r"\bbusiness program manager\b",
    r"\bproduct operations?\b",
    r"\bproduct analyst\b",
    r"\bproduct analytics\b",
    r"\bproduct strategy\b",
    r"\bproduct marketing\b",
    r"\bproduct planner\b",
    r"\bproduct specialist\b",
    r"\bproduct development\b",
)

# Roles that veto PM matching
NOT_PM_HARD = (
    r"\bproduct marketing\b",
    r"\bproduct design(?:er)?\b",
    r"\bproduct engineer",
    r"\bproduct development engineer",
    r"\bproduct security\b",
    r"\bproduct support\b",
    r"\bproduct counsel\b",
    r"\bproduct quality\b",
    r"\bproduction\b",
    r"\b(?:full ?stack|front ?end|back ?end|hardware|mechanical|electrical|systems?|"
    r"test|quality|validation|manufacturing|process|packaging|firmware|asic|silicon)"
    r"\s+engineer",
    r"\bengineering intern",
    r"\bengineer intern",
    r"\bsoftware engineer",
    r"\bdata scientist\b",
    r"\bdata science\b",
    r"\bdata engineer\b",
    r"\bui/ux\b",
    r"\bux design",
    r"\bgraphic design",
    r"\brecruit",
    r"\bsales\b",
)

# --- title: is this software engineering? ----------------------------------

STRONG_SWE = (
    r"\bsoftware\s+(?:engineer(?:ing)?|developer|development)\b",
    r"\bsoftware\s+development\s+engineer\b",
    r"\bswe\b",
    r"\bsde\b",
    r"\b(?:full\s*stack|front\s*end|back\s*end)\s+(?:engineer(?:ing)?|developer)\b",
    r"\b(?:ios|android|mobile)\s+(?:engineer(?:ing)?|developer)\b",
    r"\b(?:systems?|distributed\s+systems?|cloud|platform|infrastructure)\s+(?:engineer(?:ing)?|developer)\b",
    r"\b(?:devops|site\s+reliability|sre)\s+(?:engineer(?:ing)?|intern(?:ship)?)\b",
    r"\b(?:machine\s+learning|ml|ai|deep\s+learning)\s+(?:(?:research|software|systems|platform)\s+)?(?:engineer(?:ing)?|scientist|researcher|intern(?:ship)?|fellow)\b",
    r"\b(?:machine\s+learning|ml|ai|deep\s+learning)\s+co-?op\b",
    r"\b(?:embedded|firmware)\s+(?:software\s+)?(?:engineer(?:ing)?|developer|intern(?:ship)?)\b",
    r"\b(?:security|application\s+security|appsec|infosec)\s+(?:engineer(?:ing)?)\b",
    r"\b(?:qa|quality\s+assurance|test|sdet)\s+(?:engineer(?:ing)?|developer)\b",
    r"\b(?:data\s+engineer(?:ing)?|analytics\s+engineer(?:ing)?)\b",
    r"\b(?:data\s+scientist|data\s+science)\b",
    r"\bcomputer\s+science\s+intern(?:ship)?\b",
    r"\bweb\s+developer\b",
)

SOFT_SWE = (
    r"\bsoftware\s+intern(?:ship)?\b",
    r"\bdeveloper\s+intern(?:ship)?\b",
    r"\bengineering\s+intern(?:ship)?\b",
    r"\bengineer\s+intern(?:ship)?\b",
    r"\btech(?:nical)?\s+intern(?:ship)?\b",
    r"\bcoding\s+intern(?:ship)?\b",
    r"\bsoftware\s+co-?op\b",
    r"\bdeveloper\s+co-?op\b",
    r"\bengineering\s+co-?op\b",
)

NOT_SWE_HARD = (
    # Non-software engineering disciplines
    r"\b(?:civil|chemical|mechanical|structural|environmental|petroleum|aerospace|"
    r"materials|mining|acoustics|geotechnical|nuclear|biomedical|process|"
    r"packaging|manufacturing|industrial|facilities|optical|hardware|rf|asic|fpga|"
    r"electrical|power)\s+engineer",
    # Non-engineering roles
    r"\bproduct\s+manage(?:r|ment|rs)\b",
    r"\bproduct\s+owner\b",
    r"\bapm\b",
    r"\bproduct\s+marketing\b",
    r"\bproduct\s+design(?:er)?\b",
    r"\bproduct\s+analyst\b",
    r"\bprogram\s+manage(?:r|ment)\b",
    r"\bproject\s+manage(?:r|ment)\b",
    r"\b(?:sales|solutions|account|field\s+application|customer\s+success)\s+engineer",
    r"\bui/ux\b",
    r"\bux\s+design",
    r"\bgraphic\s+design",
    r"\bhuman\s+resources\b",
    r"\brecruit",
    r"\bfinance\b",
    r"\blegal\b",
    r"\baccounting\b",
    r"\boperations\s+analyst\b",
    r"\bbusiness\s+analyst\b",
)

# --- title: is this an internship? -----------------------------------------

INTERN_PATTERNS = (
    r"\bintern\b",
    r"\binterns\b",
    r"\binternship\b",
    r"\bco-?op\b",
    r"\bsummer 20\d\d\b",
    r"\bfall 20\d\d\b",
    r"\bwinter 20\d\d\b",
    r"\bspring 20\d\d\b",
    r"\bundergraduate\b",
    r"\bplacement\b",
    r"\bearly\s+careers?\b",
    r"\bstudent\b",
)

SENIOR_PATTERNS = (
    r"\bsenior\b", r"\bsr\.?\b", r"\bstaff\b", r"\bprincipal\b",
    r"\bdirector\b", r"\bhead of\b", r"\bvp\b", r"\bvice president\b",
    r"\blead\b",
    r"\bmanager, intern(?:ship)?s? programs?\b",
    r"\bintern(?:ship)? program manager\b",
)

# --- locations: US, Canada, UK, APAC ---------------------------------------

US_STATES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
    "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming",
]

US_ABBREV = (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO "
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
).split()

CA_PROVINCES = [
    "ontario", "quebec", "québec", "alberta", "manitoba", "saskatchewan",
    "british columbia", "nova scotia", "new brunswick", "newfoundland",
    "labrador", "prince edward island", "yukon", "nunavut",
    "northwest territories",
]

CA_ABBREV = "ON QC BC AB MB SK NS NB NL PE PEI YT NT NU".split()

US_CITIES = [
    "new york", "san francisco", "seattle", "austin", "boston", "chicago",
    "los angeles", "san jose", "mountain view", "palo alto", "menlo park",
    "sunnyvale", "santa clara", "cupertino", "redmond", "bellevue", "denver",
    "boulder", "atlanta", "miami", "dallas", "houston", "philadelphia",
    "pittsburgh", "detroit", "minneapolis", "phoenix", "portland", "san diego",
    "washington dc", "arlington", "bay area", "silicon valley", "nyc", "sf",
    "salt lake city", "kansas city", "ann arbor", "charlotte", "raleigh",
]

CA_CITIES = [
    "toronto", "vancouver", "montreal", "montréal", "ottawa", "kitchener",
    "calgary", "edmonton", "mississauga", "burnaby", "halifax", "winnipeg",
    "quebec city", "markham", "oakville", "brampton", "saskatoon", "regina",
    "london, on", "waterloo, on", "victoria, bc", "hamilton, on",
]

UK_COUNTRIES = [
    "united kingdom", "uk", "u.k.", "great britain", "england", "scotland",
    "wales", "northern ireland",
]

UK_CITIES = [
    "london", "manchester", "birmingham", "edinburgh", "glasgow", "cambridge",
    "oxford", "bristol", "leeds", "belfast", "sheffield", "newcastle",
    "liverpool", "nottingham", "southampton", "reading", "bath", "cardiff",
    "aberdeen", "dundee", "brighton", "york", "exeter",
]

APAC_COUNTRIES = [
    "singapore", "australia", "new zealand", "india", "japan", "south korea",
    "korea", "hong kong", "taiwan", "malaysia", "indonesia", "philippines",
    "vietnam", "thailand", "china",
]

APAC_REGIONS = [
    "apac", "asia pacific", "asia-pacific", "anz", "australia & new zealand",
    "east asia", "southeast asia", "se asia", "asia",
]

APAC_CITIES = [
    # Singapore
    "singapore",
    # Australia & NZ
    "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "gold coast",
    "auckland", "wellington", "christchurch",
    # India
    "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "gurgaon", "gurugram",
    "noida", "delhi", "new delhi", "chennai", "kolkata", "ahmedabad",
    # Japan
    "tokyo", "osaka", "kyoto", "yokohama", "fukuoka", "nagoya",
    # South Korea
    "seoul", "busan", "incheon", "pangyo",
    # Hong Kong & Taiwan
    "hong kong", "taipei", "hsinchu",
    # Southeast Asia
    "kuala lumpur", "penang", "jakarta", "bali", "manila", "cebu",
    "ho chi minh", "ho chi minh city", "hanoi", "da nang", "bangkok",
    # China
    "beijing", "shanghai", "shenzhen", "hangzhou",
]

APAC_ABBREV = ["SG", "AU", "NZ", "IN", "JP", "KR", "HK", "TW", "MY", "ID", "PH", "VN", "TH"]

# Non-target foreign locations (Continental Europe, LatAm, Africa, Middle East)
FOREIGN_OTHER = [
    "germany", "berlin", "munich", "frankfurt", "france", "paris",
    "spain", "madrid", "barcelona", "portugal", "lisbon", "netherlands",
    "amsterdam", "belgium", "brussels", "switzerland", "zurich", "geneva",
    "sweden", "stockholm", "norway", "oslo", "denmark", "copenhagen",
    "finland", "helsinki", "poland", "warsaw", "krakow", "czech", "prague",
    "austria", "vienna", "italy", "milan", "rome", "greece", "athens",
    "romania", "bucharest", "hungary", "budapest", "ukraine", "israel",
    "tel aviv", "brazil", "sao paulo", "são paulo", "mexico", "mexico city",
    "argentina", "buenos aires", "chile", "santiago", "colombia", "bogota",
    "peru", "lima", "south africa", "cape town", "nigeria", "lagos", "kenya",
    "nairobi", "egypt", "cairo", "dubai", "abu dhabi", "uae", "saudi",
    "riyadh", "qatar", "doha", "turkey", "istanbul", "emea", "latam",
    "europe", "ireland", "dublin",
]

NA_PHRASES = [
    "united states", "u.s.", "u.s.a", "usa", "us-remote", "remote - us",
    "remote (us)", "remote, us", "canada", "canadian", "north america",
    "remote - canada", "remote (canada)", "us or canada",
]

DEFAULT_REGIONS = {"us", "ca", "na", "uk", "apac", "remote", "unknown"}
DEFAULT_TRACKS = {"pm", "swe"}


def _matches_any(text: str, patterns) -> bool:
    return any(re.search(p, text) for p in patterns)


def _contains_word(text: str, words) -> bool:
    return any(re.search(rf"\b{re.escape(w)}\b", text) for w in words)


def is_pm_title(title: str) -> bool:
    """True only for product management roles."""
    low = title.lower()
    if _matches_any(low, NOT_PM_HARD):
        return False
    if _matches_any(low, STRONG_PM):
        return True
    return _matches_any(low, SOFT_PM)


def is_swe_title(title: str) -> bool:
    """True only for software engineering / developer roles."""
    low = title.lower()
    if _matches_any(low, NOT_SWE_HARD):
        return False
    if _matches_any(low, STRONG_SWE):
        return True
    return _matches_any(low, SOFT_SWE)


def is_internship_title(title: str) -> bool:
    """True if the title reads as an internship/co-op and not a senior role."""
    low = title.lower()
    if _matches_any(low, SENIOR_PATTERNS):
        return False
    return _matches_any(low, INTERN_PATTERNS)


def classify_track(title: str, department: str = "") -> str | None:
    """Classify role as 'pm' or 'swe', or None if neither."""
    dept_low = (department or "").lower()
    if is_pm_title(title):
        return "pm"
    if is_swe_title(title):
        return "swe"
    # Category fallback when title has intern indicator
    if is_internship_title(title) and not _matches_any(title.lower(), SENIOR_PATTERNS):
        if any(w in dept_low for w in ("product management", "product")):
            if not _matches_any(title.lower(), NOT_PM_HARD):
                return "pm"
        if any(w in dept_low for w in ("software", "software engineering", "engineering", "technology", "it", "developer")):
            if not _matches_any(title.lower(), NOT_SWE_HARD):
                return "swe"
    return None


def location_region(location: str) -> str:
    """Classify a location string as 'us', 'ca', 'na', 'uk', 'apac', 'remote', 'foreign', or 'unknown'."""
    if not location or not location.strip():
        return "unknown"
    low = location.lower()

    # 1. Canada
    has_ca = (
        "canada" in low
        or _contains_word(low, CA_CITIES)
        or _contains_word(low, CA_PROVINCES)
        or any(re.search(rf",\s*{ab}\b", location) for ab in CA_ABBREV)
    )

    # 2. United States
    has_us = (
        any(phrase in low for phrase in ("united states", "usa", "u.s."))
        or re.search(r"\bus\b", low) is not None
        or _contains_word(low, US_CITIES)
        or _contains_word(low, US_STATES)
        or any(re.search(rf",\s*{ab}\b", location) for ab in US_ABBREV)
    )

    # 3. United Kingdom
    has_uk = (
        any(phrase in low for phrase in UK_COUNTRIES)
        or _contains_word(low, UK_CITIES)
        or re.search(r"\b(?:uk|u\.k\.)\b", low) is not None
        or re.search(r",\s*(?:uk|england|scotland|wales)\b", low) is not None
    )

    # 4. APAC (Asia-Pacific)
    has_apac = (
        any(re.search(rf"\b{re.escape(c)}\b", low) for c in APAC_COUNTRIES)
        or _contains_word(low, APAC_CITIES)
        or any(re.search(rf"\b{re.escape(r)}\b", low) for r in APAC_REGIONS)
        or any(re.search(rf",\s*{ab}\b", location) for ab in APAC_ABBREV)
    )

    # 5. Remote
    has_remote = (
        "remote" in low
        or "anywhere" in low
        or "work from home" in low
        or "telecommute" in low
    )

    # 6. Other foreign (non-target)
    has_other_foreign = any(country in low for country in FOREIGN_OTHER)

    # Hard country evidence overrides bare city guessing
    if has_uk and not (has_us or has_ca):
        return "uk"
    if has_apac and not (has_us or has_ca):
        return "apac"
    if has_us and has_ca:
        return "na"
    if has_ca:
        return "ca"
    if has_us:
        return "us"
    if has_uk:
        return "uk"
    if has_apac:
        return "apac"
    if any(phrase in low for phrase in NA_PHRASES):
        return "na"
    if has_other_foreign:
        return "foreign"
    if has_remote:
        return "remote"
    return "unknown"


def is_north_america(location: str) -> bool:
    """Legacy helper: True if location is in US/CA or unknown."""
    return location_region(location) in ("us", "ca", "na", "remote", "unknown")


def is_allowed_region(location: str, allowed_regions: set[str] | None = None) -> bool:
    allowed = allowed_regions if allowed_regions is not None else DEFAULT_REGIONS
    region = location_region(location)
    return region in allowed


def matches(job, *, require_location: bool = True, tracks: set[str] | None = None,
            allowed_regions: set[str] | None = None) -> bool:
    """Filter: matches configured tracks (PM/SWE) and target regions (US/CA/UK/APAC)."""
    active_tracks = tracks if tracks is not None else DEFAULT_TRACKS
    active_regions = allowed_regions if allowed_regions is not None else DEFAULT_REGIONS

    # Must read as an internship
    if not is_internship_title(job.title):
        return False

    # Classify track
    track = classify_track(job.title, getattr(job, "department", ""))
    if not track or track not in active_tracks:
        return False
    job.track = track

    # Classify location
    region = location_region(job.location)
    job.region = region
    if require_location and region not in active_regions:
        return False

    return True


# Narrower veto for watchlist adjacency
NOT_ADJACENT = (
    r"\bproduct engineer",
    r"\bproduct development engineer",
    r"\bproduct design(?:er)?\b",
    r"\bproduct security\b",
    r"\bproduct quality\b",
    r"\bproduct counsel\b",
    r"\bproduction\b",
    r"\b(?:full ?stack|front ?end|back ?end|hardware|mechanical|electrical|systems?|"
    r"test|quality|validation|manufacturing|process|packaging|firmware|asic|silicon)"
    r"\s+engineer",
    r"\bengineering intern",
    r"\bengineer intern",
    r"\bsoftware engineer",
    r"\bdata scientist\b",
    r"\bdata science\b",
    r"\bdata engineer\b",
    r"\bui/ux\b",
    r"\bux design",
    r"\bgraphic design",
    r"\brecruit",
)


def is_adjacent_title(title: str) -> bool:
    """Product management or adjacent roles."""
    low = title.lower()
    if _matches_any(low, NOT_ADJACENT):
        return False
    return (_matches_any(low, STRONG_PM) or _matches_any(low, SOFT_PM)
            or _matches_any(low, PRODUCT_ADJACENT))


def matches_watchlist(job, watchlist, allowed_regions: set[str] | None = None) -> bool:
    """Additive watchlist rules."""
    if not watchlist:
        return False
    active_regions = allowed_regions if allowed_regions is not None else DEFAULT_REGIONS
    company = (job.company or "").lower()
    for entry in watchlist:
        name = (entry.get("company") or "").lower()
        if not name or name not in company:
            continue
        if _matches_any(job.title.lower(), SENIOR_PATTERNS):
            continue
        if entry.get("require_internship", True) and not is_internship_title(job.title):
            continue
        keywords = entry.get("titles")
        if keywords:
            low = job.title.lower()
            if not any(k.lower() in low for k in keywords):
                continue
            if _matches_any(low, NOT_ADJACENT):
                continue
        elif not is_adjacent_title(job.title):
            continue
        regions = entry.get("regions")
        job_region = location_region(job.location)
        if regions and job_region not in set(regions) | {"na"}:
            continue
        if job_region not in active_regions:
            continue
        job.track = "pm"
        job.region = job_region
        return True
    return False
