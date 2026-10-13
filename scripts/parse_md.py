import re
from pathlib import Path

def parse_jobs_md(md_path='JOBS.md'):
    lines = Path(md_path).read_text(encoding='utf-8').splitlines()
    
    current_track = None
    current_region = None
    
    region_map = {
        '🇺🇸': 'us',
        '🇨🇦': 'ca',
        '🇬🇧': 'uk',
        '🌏': 'apac',
        '🌐': 'remote',
        '🇨🇦/🇺🇸': 'na',
        '🌍': 'foreign',
        '📍': 'unknown',
    }
    
    jobs = []
    
    for line in lines:
        line_str = line.strip()
        if line_str.startswith('## 📋 Product Management Internships'):
            current_track = 'pm'
            current_region = None
            continue
        elif line_str.startswith('## 💻 Software Engineering Internships'):
            current_track = 'swe'
            continue
        elif line_str.startswith('### 🇺🇸 United States SWE'):
            current_track = 'swe'
            current_region = 'us'
            continue
        elif line_str.startswith('### 🇨🇦 Canada SWE'):
            current_track = 'swe'
            current_region = 'ca'
            continue
        elif line_str.startswith('### 🇬🇧 United Kingdom SWE'):
            current_track = 'swe'
            current_region = 'uk'
            continue
        elif line_str.startswith('### 🌏 Asia-Pacific (APAC) SWE'):
            current_track = 'swe'
            current_region = 'apac'
            continue
        elif line_str.startswith('### 🌐 Remote SWE'):
            current_track = 'swe'
            current_region = 'remote'
            continue
        elif line_str.startswith('### 🇨🇦/🇺🇸 North America (US/CA) SWE'):
            current_track = 'swe'
            current_region = 'na'
            continue
        elif line_str.startswith('### 📍 Other / Unspecified SWE'):
            current_track = 'swe'
            current_region = 'unknown'
            continue
        elif line_str.startswith('## '):
            current_track = None
            current_region = None
            continue

        if not current_track:
            continue
            
        if not line_str.startswith('|') or ':---' in line_str or 'Date Posted' in line_str:
            continue
            
        parts = [p.strip() for p in line_str.split('|')[1:-1]]
        
        if current_track == 'pm' and len(parts) >= 6:
            dt = parts[0].strip('` ')
            reg_flag = parts[1].strip()
            reg = region_map.get(reg_flag, 'unknown')
            comp = parts[2].replace('**', '').strip()
            title = parts[3].strip()
            loc = parts[4].strip()
            link_match = re.search(r'\((https?://[^)]+)\)', parts[5])
            url = link_match.group(1) if link_match else ''
            jobs.append({
                'posted_at': dt,
                'track': 'pm',
                'region': reg,
                'company': comp,
                'title': title,
                'location': loc,
                'url': url
            })
        elif current_track == 'swe' and len(parts) >= 5:
            dt = parts[0].strip('` ')
            comp = parts[1].replace('**', '').strip()
            title = parts[2].strip()
            loc = parts[3].strip()
            link_match = re.search(r'\((https?://[^)]+)\)', parts[4])
            url = link_match.group(1) if link_match else ''
            jobs.append({
                'posted_at': dt,
                'track': 'swe',
                'region': current_region or 'unknown',
                'company': comp,
                'title': title,
                'location': loc,
                'url': url
            })
            
    return jobs

if __name__ == '__main__':
    jobs = parse_jobs_md()
    print('Total parsed jobs from JOBS.md:', len(jobs))
    pm_jobs = [j for j in jobs if j['track'] == 'pm']
    swe_jobs = [j for j in jobs if j['track'] == 'swe']
    print(f'PM: {len(pm_jobs)}, SWE: {len(swe_jobs)}')
    oct13 = [j for j in jobs if '2026-10-13' in j['posted_at']]
    print(f'Oct 13 jobs: {len(oct13)}')
    for j in oct13[:8]:
        print(' ', j['posted_at'], j['track'], j['region'], j['company'], '->', j['title'])
