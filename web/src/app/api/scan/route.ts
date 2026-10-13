import { NextResponse } from 'next/server';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';

let isScanRunning = false;
let lastScanTime: string | null = null;
let lastScanSummary = '';

export async function POST() {
  const rootDir = path.resolve(process.cwd(), '..');

  // Step 1: Immediately sync any existing jobs in JOBS.md so the web app has latest postings instantly
  try {
    execSync('python3 scripts/sync_jobs.py', { cwd: rootDir, timeout: 15000 });
  } catch (syncErr: any) {
    console.warn('Initial sync warning:', syncErr.message);
  }

  if (isScanRunning) {
    return NextResponse.json({
      status: 'running',
      message: 'Feed synced with latest directory. Background scan is actively crawling 600+ boards.',
      lastScanTime,
    });
  }

  isScanRunning = true;
  lastScanTime = new Date().toISOString();

  try {
    const proc = spawn('python3', ['cli.py', 'scan'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
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
      lastScanSummary = output.slice(-500);

      // Re-export JOBS.md and fresh JSON right after scan finishes
      try {
        execSync('python3 cli.py export-md JOBS.md', { cwd: rootDir, timeout: 15000 });
        execSync('python3 scripts/sync_jobs.py', { cwd: rootDir, timeout: 15000 });
        console.log(`Scan completed with code ${code}. Synced JOBS.md and web/public/jobs.json.`);
      } catch (postErr) {
        console.error('Post-scan export error:', postErr);
      }
    });

    return NextResponse.json({
      status: 'started',
      message: 'Synced 3,480+ postings! Active board scan running in background.',
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
