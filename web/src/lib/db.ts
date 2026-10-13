import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DATABASE_PATH || path.resolve(process.cwd(), '../jobs.db');

export interface JobRecord {
  key: string;
  source: string;
  company: string;
  board: string;
  external_id: string;
  title: string;
  location: string;
  url: string;
  posted_at: string;
  department: string;
  first_seen: string;
  last_seen: string;
  closed_at: string;
  status: string;
  status_at: string;
  notes: string;
  track: string;
  region: string;
}

export function getDb() {
  if (!fs.existsSync(/*turbopackIgnore: true*/ DB_PATH)) {
    throw new Error(`Database not found at ${DB_PATH}`);
  }
  return new DatabaseSync(DB_PATH);
}

export function queryJobs(options: {
  queue?: string;
  track?: string;
  region?: string;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions: string[] = ["closed_at = ''"];
  const params: any[] = [];

  // Queue mapping
  const queue = options.queue || 'inbox';
  if (queue === 'inbox') {
    conditions.push("status = 'new'");
  } else if (queue === 'applied') {
    conditions.push("status IN ('applied', 'interview', 'offer')");
  } else if (queue === 'dismissed') {
    conditions.push("status IN ('ignored', 'rejected')");
  } else if (queue === 'saved') {
    conditions.push("status = 'saved'");
  }

  // Track filter
  if (options.track && options.track !== 'all') {
    conditions.push('LOWER(track) = ?');
    params.push(options.track.toLowerCase());
  }

  // Region filter
  if (options.region && options.region !== 'all') {
    conditions.push('LOWER(region) = ?');
    params.push(options.region.toLowerCase());
  }

  // Search filter
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim().toLowerCase()}%`;
    conditions.push('(LOWER(company) LIKE ? OR LOWER(title) LIKE ? OR LOWER(location) LIKE ?)');
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 500;
  const offset = options.offset || 0;

  // Sorting
  let orderBy = "ORDER BY COALESCE(NULLIF(posted_at, ''), first_seen) DESC, first_seen DESC";
  if (options.sort === 'company') {
    orderBy = 'ORDER BY company COLLATE NOCASE ASC, title COLLATE NOCASE ASC';
  }

  const query = `
    SELECT key, source, company, board, external_id, title, location, url,
           posted_at, department, first_seen, last_seen, closed_at, status,
           status_at, notes, track, region
    FROM jobs
    ${whereClause}
    ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...params, limit, offset) as unknown as JobRecord[];

  // Counts for each queue
  const countsQuery = `
    SELECT 
      SUM(CASE WHEN status = 'new' AND closed_at = '' THEN 1 ELSE 0 END) as inbox,
      SUM(CASE WHEN status IN ('applied', 'interview', 'offer') AND closed_at = '' THEN 1 ELSE 0 END) as applied,
      SUM(CASE WHEN status IN ('ignored', 'rejected') AND closed_at = '' THEN 1 ELSE 0 END) as dismissed,
      SUM(CASE WHEN status = 'saved' AND closed_at = '' THEN 1 ELSE 0 END) as saved,
      SUM(CASE WHEN closed_at = '' THEN 1 ELSE 0 END) as total
    FROM jobs
  `;
  const counts = (db.prepare(countsQuery).get() || {}) as Record<string, number>;

  // Track breakdown
  const tracksQuery = `
    SELECT track, COUNT(*) as n 
    FROM jobs 
    WHERE closed_at = '' 
    GROUP BY track
  `;
  const tracksRows = db.prepare(tracksQuery).all() as unknown as { track: string; n: number }[];
  const tracks: Record<string, number> = {};
  for (const r of tracksRows) {
    tracks[r.track || 'pm'] = r.n;
  }

  // Region breakdown
  const regionsQuery = `
    SELECT region, COUNT(*) as n 
    FROM jobs 
    WHERE closed_at = '' 
    GROUP BY region
  `;
  const regionsRows = db.prepare(regionsQuery).all() as unknown as { region: string; n: number }[];
  const regions: Record<string, number> = {};
  for (const r of regionsRows) {
    regions[r.region || 'unknown'] = r.n;
  }

  return {
    jobs: rows,
    counts: {
      inbox: counts.inbox || 0,
      applied: counts.applied || 0,
      dismissed: counts.dismissed || 0,
      saved: counts.saved || 0,
      total: counts.total || 0,
    },
    tracks,
    regions,
  };
}

export function updateJobStatus(key: string, status: string, notes?: string) {
  const db = getDb();
  const now = new Date().toISOString();

  let updateQuery = "UPDATE jobs SET status = ?, status_at = ? WHERE key = ?";
  const params: any[] = [status, now, key];

  if (notes !== undefined) {
    updateQuery = "UPDATE jobs SET status = ?, status_at = ?, notes = ? WHERE key = ?";
    params.splice(2, 0, notes);
  }

  db.prepare(updateQuery).run(...params);

  // Return the updated job
  const updated = db.prepare("SELECT * FROM jobs WHERE key = ?").get(key) as unknown as JobRecord;

  // Also sync to tracker.json so GitHub repo stays updated
  try {
    const trackerPath = path.resolve(process.cwd(), '../tracker.json');
    const rows = db.prepare(`
      SELECT key, company, title, url, location, status, status_at, notes
      FROM jobs 
      WHERE status != 'new' OR notes != '' 
      ORDER BY status_at
    `).all() as unknown as any[];

    const data: Record<string, any> = {};
    for (const r of rows) {
      data[r.key] = {
        company: r.company,
        title: r.title,
        url: r.url,
        location: r.location,
        status: r.status,
        status_at: r.status_at,
        notes: r.notes,
      };
    }
    fs.writeFileSync(trackerPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error('Failed to update tracker.json:', err);
  }

  return updated;
}
