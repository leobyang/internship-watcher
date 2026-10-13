import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';

let isScanRunning = false;
let lastScanTime: string | null = null;
let lastScanSummary = '';

export async function POST() {
  if (isScanRunning) {
    return NextResponse.json({
      status: 'running',
      message: 'A job scan is already running in background.',
      lastScanTime,
    });
  }

  const rootDir = path.resolve(process.cwd(), '..');
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

      // Export fresh JSON right after scan
      const exp = spawn('python3', ['cli.py', 'export-json', 'web/public/jobs.json'], {
        cwd: rootDir,
      });
      exp.on('close', () => {
        console.log(`Scan completed with code ${code}. Exported web/public/jobs.json.`);
      });
    });

    return NextResponse.json({
      status: 'started',
      message: 'Job scan started across active career boards.',
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
