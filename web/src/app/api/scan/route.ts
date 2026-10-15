import { NextResponse } from 'next/server';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';

let isScanRunning = false;
let lastScanTime: string | null = null;
let lastScanSummary = '';

export async function POST() {
  const rootDir = path.resolve(process.cwd(), '..');

  if (isScanRunning) {
    return NextResponse.json({
      status: 'running',
      message: '⚡ Live scan in progress: querying 670+ career boards online...',
      lastScanTime,
    });
  }

  isScanRunning = true;
  lastScanTime = new Date().toISOString();
  lastScanSummary = 'Checking career boards online for new postings...';

  try {
    // Sync any repo changes from JOBS.md / tracker into DB before scanning
    try {
      execSync('python3 scripts/sync_jobs.py', { cwd: rootDir, timeout: 15000 });
    } catch {}

    const proc = spawn('python3', ['-u', 'cli.py', 'scan'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PMINTERN_FAST: '1' },
    });

    let output = '';
    proc.stdout?.on('data', (d) => {
      output += d.toString();
    });
    proc.stderr?.on('data', (d) => {
      output += d.toString();
    });

    proc.on('close', (code) => {
      isScanRunning = false;
      const cleanOutput = output.trim();
      const lines = cleanOutput.split('\n').map((l) => l.trim()).filter(Boolean);
      // Look for the scan summary line: "scanned X boards in Ys | Z matching live | N new"
      const summaryLine = lines.find((l) => l.startsWith('scanned ')) || lines[lines.length - 1] || '';
      lastScanSummary = summaryLine || `Live board scan completed (code ${code})`;

      // Export fresh JSON and markdown directory right after online scan finishes
      try {
        execSync('python3 cli.py export-md JOBS.md', { cwd: rootDir, timeout: 25000 });
        execSync('python3 scripts/sync_jobs.py', { cwd: rootDir, timeout: 25000 });
        execSync('python3 cli.py export-json web/public/jobs.json', { cwd: rootDir, timeout: 25000 });
        console.log(`Live scan finished (${code}): ${lastScanSummary}`);
      } catch (postErr: any) {
        console.error('Post-scan export error:', postErr.message);
      }
    });

    return NextResponse.json({
      status: 'started',
      message: '⚡ Live scan started: querying 670+ career boards online for new postings...',
      lastScanTime,
    });
  } catch (err: any) {
    isScanRunning = false;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    isRunning: isScanRunning,
    lastScanTime,
    lastScanSummary,
  });
}
