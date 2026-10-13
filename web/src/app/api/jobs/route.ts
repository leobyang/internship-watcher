import { NextRequest, NextResponse } from 'next/server';
import { queryJobs, updateJobStatus } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queue = searchParams.get('queue') || 'inbox';
    const track = searchParams.get('track') || 'all';
    const region = searchParams.get('region') || 'all';
    const search = searchParams.get('search') || '';
    const sort = searchParams.get('sort') || 'newest';
    const limit = parseInt(searchParams.get('limit') || '500', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const result = queryJobs({ queue, track, region, search, sort, limit, offset });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch jobs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, status, notes } = body;

    if (!key || !status) {
      return NextResponse.json({ error: 'Missing required fields: key and status' }, { status: 400 });
    }

    const updated = updateJobStatus(key, status, notes);
    return NextResponse.json({ success: true, job: updated });
  } catch (error: any) {
    console.error('Error updating job:', error);
    return NextResponse.json({ error: error.message || 'Failed to update job' }, { status: 500 });
  }
}
