'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

interface Job {
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

interface Counts {
  inbox: number;
  applied: number;
  dismissed: number;
  saved: number;
  total: number;
}

const REGION_FLAGS: Record<string, string> = {
  us: '🇺🇸',
  ca: '🇨🇦',
  uk: '🇬🇧',
  apac: '🌏',
  remote: '🌐',
  na: '🇨🇦/🇺🇸',
  foreign: '🌍',
  unknown: '📍',
};

const COMPANY_COLORS: Record<string, string> = {
  Google: 'bg-[#4285F4]',
  Microsoft: 'bg-[#00A4EF]',
  Apple: 'bg-[#555555]',
  Amazon: 'bg-[#FF9900]',
  Meta: 'bg-[#0668E1]',
  Stripe: 'bg-[#635BFF]',
  Figma: 'bg-[#F24E1E]',
  Datadog: 'bg-[#632CA6]',
  OpenAI: 'bg-[#10A37F]',
  Anthropic: 'bg-[#D97706]',
  Ramp: 'bg-[#2764FF]',
  Uber: 'bg-[#000000]',
  Robinhood: 'bg-[#00C805]',
  Airbnb: 'bg-[#FF5A5F]',
  Netflix: 'bg-[#E50914]',
  Palantir: 'bg-[#101113]',
  Spotify: 'bg-[#1DB954]',
};

function getMonogramColor(company: string) {
  if (COMPANY_COLORS[company]) return COMPANY_COLORS[company];
  const colors = [
    'bg-[#4f46e5]',
    'bg-[#059669]',
    'bg-[#0284c7]',
    'bg-[#d97706]',
    'bg-[#7c3aed]',
    'bg-[#db2777]',
    'bg-[#ea580c]',
    'bg-[#0891b2]',
  ];
  let hash = 0;
  for (let i = 0; i < company.length; i++) {
    hash = company.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

function getLocalOverrides(): Record<string, { status: string; notes?: string; status_at?: string }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('internship_tracker_overrides');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setLocalOverride(key: string, status: string, notes?: string) {
  if (typeof window === 'undefined') return;
  try {
    const overrides = getLocalOverrides();
    overrides[key] = {
      status,
      notes: notes !== undefined ? notes : overrides[key]?.notes || '',
      status_at: new Date().toISOString(),
    };
    localStorage.setItem('internship_tracker_overrides', JSON.stringify(overrides));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

export default function InternshipTracker() {
  const [queue, setQueue] = useState<'inbox' | 'applied' | 'dismissed' | 'saved'>('inbox');
  const [trackFilter, setTrackFilter] = useState<'all' | 'pm' | 'swe'>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [sortOption, setSortOption] = useState<'newest' | 'company'>('newest');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [counts, setCounts] = useState<Counts>({ inbox: 0, applied: 0, dismissed: 0, saved: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inspectingJob, setInspectingJob] = useState<Job | null>(null);
  const [isCloudStatic, setIsCloudStatic] = useState<boolean>(false);

  const [toast, setToast] = useState<{ message: string; lastKey?: string; prevStatus?: string } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const staticJobsCacheRef = useRef<Job[] | null>(null);

  // Fetch jobs
  const fetchJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        queue,
        track: trackFilter,
        region: regionFilter,
        sort: sortOption,
        search: searchTerm,
      });

      let loadedData: { jobs: Job[]; counts: Counts } | null = null;

      // 1. Try local API first
      try {
        const res = await fetch(`${BASE_PATH}/api/jobs?${params.toString()}`);
        if (res.ok) {
          loadedData = await res.json();
          setIsCloudStatic(false);
        }
      } catch {
        // API not available, proceed to static fallback
      }

      // 2. Static GitHub Pages fallback
      if (!loadedData) {
        setIsCloudStatic(true);
        if (!staticJobsCacheRef.current) {
          const res = await fetch(`${BASE_PATH}/jobs.json`);
          if (!res.ok) throw new Error('Failed to load static jobs.json');
          const jsonPayload = await res.json();
          staticJobsCacheRef.current = jsonPayload.jobs || [];
        }

        const overrides = getLocalOverrides();
        const allJobs = (staticJobsCacheRef.current || []).map((j) => {
          const ov = overrides[j.key];
          if (ov) {
            return { ...j, status: ov.status, notes: ov.notes !== undefined ? ov.notes : j.notes };
          }
          return j;
        });

        // Compute counts across all jobs
        const computedCounts: Counts = {
          inbox: allJobs.filter((j) => !j.status || j.status === 'new' || j.status === 'none').length,
          applied: allJobs.filter((j) => j.status === 'applied').length,
          dismissed: allJobs.filter((j) => j.status === 'ignored').length,
          saved: allJobs.filter((j) => j.status === 'saved').length,
          total: allJobs.length,
        };

        // Filter by queue
        let filtered = allJobs.filter((j) => {
          const st = j.status || 'new';
          if (queue === 'inbox') return st === 'new' || st === 'none';
          if (queue === 'applied') return st === 'applied';
          if (queue === 'dismissed') return st === 'ignored';
          if (queue === 'saved') return st === 'saved';
          return true;
        });

        // Filter by track
        if (trackFilter !== 'all') {
          filtered = filtered.filter((j) => (j.track || 'pm').toLowerCase() === trackFilter);
        }

        // Filter by region
        if (regionFilter !== 'all') {
          filtered = filtered.filter((j) => (j.region || 'unknown').toLowerCase() === regionFilter);
        }

        // Filter by search
        if (searchTerm.trim()) {
          const s = searchTerm.toLowerCase();
          filtered = filtered.filter(
            (j) =>
              j.company.toLowerCase().includes(s) ||
              j.title.toLowerCase().includes(s) ||
              (j.location && j.location.toLowerCase().includes(s))
          );
        }

        // Sort
        filtered.sort((a, b) => {
          if (sortOption === 'company') {
            return a.company.localeCompare(b.company);
          }
          const dateA = a.posted_at || a.first_seen || '';
          const dateB = b.posted_at || b.first_seen || '';
          return dateB.localeCompare(dateA);
        });

        loadedData = { jobs: filtered, counts: computedCounts };
      }

      setJobs(loadedData.jobs || []);
      setCounts(loadedData.counts || { inbox: 0, applied: 0, dismissed: 0, saved: 0, total: 0 });

      // Keep active selection or pick first
      if (loadedData.jobs && loadedData.jobs.length > 0) {
        setSelectedKey((prev) => {
          if (prev && loadedData!.jobs.some((j: Job) => j.key === prev)) return prev;
          return loadedData!.jobs[0].key;
        });
      } else {
        setSelectedKey(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [queue, trackFilter, regionFilter, sortOption, searchTerm]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Update status
  const handleUpdateStatus = async (key: string, newStatus: string, actionMsg?: string) => {
    const targetJob = jobs.find((j) => j.key === key);
    if (!targetJob) return;

    const prevStatus = targetJob.status;

    // Optimistically update UI
    setJobs((prev) => prev.filter((j) => j.key !== key));
    setCounts((prev) => {
      const updated = { ...prev };
      if (prevStatus === 'new') updated.inbox = Math.max(0, updated.inbox - 1);
      if (prevStatus === 'applied') updated.applied = Math.max(0, updated.applied - 1);
      if (prevStatus === 'ignored') updated.dismissed = Math.max(0, updated.dismissed - 1);
      if (prevStatus === 'saved') updated.saved = Math.max(0, updated.saved - 1);

      if (newStatus === 'new') updated.inbox++;
      if (newStatus === 'applied') updated.applied++;
      if (newStatus === 'ignored') updated.dismissed++;
      if (newStatus === 'saved') updated.saved++;

      return updated;
    });

    // Advance selection
    const currentIndex = jobs.findIndex((j) => j.key === key);
    if (currentIndex >= 0 && currentIndex < jobs.length - 1) {
      setSelectedKey(jobs[currentIndex + 1].key);
    } else if (jobs.length > 1) {
      setSelectedKey(jobs[0].key);
    } else {
      setSelectedKey(null);
    }

    // Trigger toast
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({
      message: actionMsg || `Moved ${targetJob.company} to ${newStatus}`,
      lastKey: key,
      prevStatus,
    });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);

    // Save to local storage for static mode
    setLocalOverride(key, newStatus);

    // Call API if available
    try {
      await fetch(`${BASE_PATH}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, status: newStatus }),
      });
    } catch (e) {
      console.warn('API sync bypassed in static mode:', e);
    }
  };

  // Undo last action
  const handleUndo = async () => {
    if (!toast?.lastKey || !toast?.prevStatus) return;
    const { lastKey, prevStatus } = toast;
    setToast(null);

    setLocalOverride(lastKey, prevStatus);

    try {
      await fetch(`${BASE_PATH}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: lastKey, status: prevStatus }),
      });
    } catch (e) {
      console.warn('API sync bypassed in static mode:', e);
    }
    fetchJobs();
  };

  // Export & Import local decisions
  const handleExportDecisions = () => {
    const overrides = getLocalOverrides();
    const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportDecisions = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const existing = getLocalOverrides();
        const merged = { ...existing, ...parsed };
        localStorage.setItem('internship_tracker_overrides', JSON.stringify(merged));
        fetchJobs();
        setToast({ message: `Imported ${Object.keys(parsed).length} decisions!` });
      } catch {
        alert('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
  };

  // Open active portal link
  const handleOpenActivePortal = (jobToOpen?: Job | null) => {
    const current = jobToOpen || jobs.find((j) => j.key === selectedKey);
    if (current && current.url) {
      window.open(current.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in search or an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        isSearchOpen
      ) {
        if (e.key === 'Escape') {
          setIsSearchOpen(false);
          setInspectingJob(null);
        }
        return;
      }

      // Command + K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      if (e.key === 'Escape') {
        setInspectingJob(null);
        return;
      }

      const currentIndex = jobs.findIndex((j) => j.key === selectedKey);

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          if (currentIndex < jobs.length - 1) {
            setSelectedKey(jobs[currentIndex + 1].key);
            // Scroll item into view
            const el = document.getElementById(`job-${jobs[currentIndex + 1].key}`);
            el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;

        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          if (currentIndex > 0) {
            setSelectedKey(jobs[currentIndex - 1].key);
            const el = document.getElementById(`job-${jobs[currentIndex - 1].key}`);
            el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;

        case 'a':
        case 'A':
          e.preventDefault();
          if (selectedKey) handleUpdateStatus(selectedKey, 'applied', `Applied to ${jobs[currentIndex]?.company}!`);
          break;

        case 'd':
        case 'D':
          e.preventDefault();
          if (selectedKey) handleUpdateStatus(selectedKey, 'ignored', `Dismissed ${jobs[currentIndex]?.company}`);
          break;

        case 's':
        case 'S':
          e.preventDefault();
          if (selectedKey) handleUpdateStatus(selectedKey, 'saved', `Starred ${jobs[currentIndex]?.company}`);
          break;

        case 'o':
        case 'O':
        case 'Enter':
          e.preventDefault();
          handleOpenActivePortal();
          break;

        case ' ': // Space opens inspector
          e.preventDefault();
          if (jobs[currentIndex]) setInspectingJob(jobs[currentIndex]);
          break;

        case 'z':
        case 'Z':
          e.preventDefault();
          handleUndo();
          break;

        case '1':
          e.preventDefault();
          setQueue('inbox');
          break;

        case '2':
          e.preventDefault();
          setQueue('applied');
          break;

        case '3':
          e.preventDefault();
          setQueue('dismissed');
          break;

        case '4':
          e.preventDefault();
          setQueue('saved');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jobs, selectedKey, isSearchOpen, toast]);

  return (
    <div className="bg-[#121318] text-[#e3e1e9] h-screen flex overflow-hidden select-none font-sans">
      {/* COLUMN 1: LEFT SIDEBAR */}
      <aside className="w-64 border-r border-[#292a36] bg-[#121318] flex flex-col justify-between shrink-0 h-full z-30">
        <div className="flex flex-col">
          {/* Brand Title */}
          <div className="h-14 px-4 border-b border-[#292a36] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                <span className="material-symbols-outlined text-[18px]">bolt</span>
              </div>
              <span className="font-semibold text-[14px] tracking-tight text-white">
                Leo&apos;s Internship Tracker
              </span>
            </div>
          </div>

          {/* Queues Section */}
          <div className="p-3">
            <div className="px-2.5 pb-2 text-[10px] font-semibold tracking-wider text-gray-400 uppercase font-mono flex items-center justify-between">
              <span>Queues</span>
              <span className="text-[9px] text-gray-500 font-normal">1-4 KEYS</span>
            </div>

            <nav className="flex flex-col gap-1.5" id="nav-queue-list">
              {/* Inbox (Pending) */}
              <button
                onClick={() => setQueue('inbox')}
                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg transition-all group ${
                  queue === 'inbox'
                    ? 'bg-[#1a1b22] text-white font-medium border border-[#383949] shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1b22]/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[17px] text-indigo-400">inbox</span>
                  <span className="text-xs">Inbox (Pending)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded">
                    {counts.inbox.toLocaleString()}
                  </span>
                  <kbd className="font-mono text-[10px] text-gray-500">1</kbd>
                </div>
              </button>

              {/* Applied */}
              <button
                onClick={() => setQueue('applied')}
                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg transition-all group ${
                  queue === 'applied'
                    ? 'bg-[#1a1b22] text-white font-medium border border-[#383949] shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1b22]/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[17px] text-emerald-400">send_and_archive</span>
                  <span className="text-xs">Applied</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-300 bg-[#22232c] px-1.5 py-0.2 rounded border border-[#292a36]">
                    {counts.applied.toLocaleString()}
                  </span>
                  <kbd className="font-mono text-[10px] text-gray-500">2</kbd>
                </div>
              </button>

              {/* Dismissed */}
              <button
                onClick={() => setQueue('dismissed')}
                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg transition-all group ${
                  queue === 'dismissed'
                    ? 'bg-[#1a1b22] text-white font-medium border border-[#383949] shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1b22]/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[17px] text-rose-400">archive</span>
                  <span className="text-xs">Dismissed</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-300 bg-[#22232c] px-1.5 py-0.2 rounded border border-[#292a36]">
                    {counts.dismissed.toLocaleString()}
                  </span>
                  <kbd className="font-mono text-[10px] text-gray-500">3</kbd>
                </div>
              </button>

              {/* Saved */}
              <button
                onClick={() => setQueue('saved')}
                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg transition-all group ${
                  queue === 'saved'
                    ? 'bg-[#1a1b22] text-white font-medium border border-[#383949] shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1b22]/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[17px] text-amber-400">bookmark</span>
                  <span className="text-xs">Saved (Starred)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-300 bg-[#22232c] px-1.5 py-0.2 rounded border border-[#292a36]">
                    {counts.saved.toLocaleString()}
                  </span>
                  <kbd className="font-mono text-[10px] text-gray-500">4</kbd>
                </div>
              </button>
            </nav>
          </div>
        </div>

        {/* Shortcuts Cheatsheet Card */}
        <div className="p-3">
          <div className="bg-[#1a1b22] border border-[#292a36] p-3 rounded-lg flex flex-col gap-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-gray-400 font-mono uppercase tracking-wider">
              <span>Shortcuts</span>
              <span className="text-indigo-400 flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[13px]">bolt</span> Speedy
              </span>
            </div>
            <div className="flex flex-col gap-1.5 text-[11px] text-gray-400">
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Navigate</span>
                <span className="font-mono text-gray-400 flex gap-1">
                  <kbd className="bg-[#22232c] text-gray-200 px-1 py-0.5 rounded border border-[#292a36] text-[10px]">J</kbd>
                  <kbd className="bg-[#22232c] text-gray-200 px-1 py-0.5 rounded border border-[#292a36] text-[10px]">K</kbd>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Apply &amp; Move</span>
                <kbd className="font-mono bg-[#22232c] text-emerald-400 px-1.5 py-0.5 rounded border border-[#292a36] text-[10px]">A</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Dismiss</span>
                <kbd className="font-mono bg-[#22232c] text-rose-400 px-1.5 py-0.5 rounded border border-[#292a36] text-[10px]">D</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Save</span>
                <kbd className="font-mono bg-[#22232c] text-amber-400 px-1.5 py-0.5 rounded border border-[#292a36] text-[10px]">S</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Open Link</span>
                <kbd className="font-mono bg-[#22232c] text-indigo-400 px-1.5 py-0.5 rounded border border-[#292a36] text-[10px]">↵ Enter</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Quick Inspect</span>
                <kbd className="font-mono bg-[#22232c] text-gray-200 px-1.5 py-0.5 rounded border border-[#292a36] text-[10px]">Space</kbd>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[#292a36]/60">
                <span className="text-gray-400 text-[10px]">Undo</span>
                <kbd className="font-mono bg-[#22232c] text-gray-400 px-1 py-0.5 rounded border border-[#292a36] text-[10px]">Z</kbd>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* COLUMN 2: MAIN CONTENT AREA (High-density Feed) */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#121318]">
        {/* Top Header */}
        <header className="h-14 border-b border-[#292a36] bg-[#121318] px-6 flex items-center justify-between shrink-0 z-20">
          {/* Search Trigger */}
          <div className="w-full max-w-xl">
            <div
              onClick={() => {
                setIsSearchOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className="w-full flex items-center justify-between bg-[#1a1b22] border border-[#292a36] px-3.5 py-1.5 rounded-lg text-sm text-gray-400 hover:border-gray-500 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[17px] text-gray-400 group-hover:text-gray-300">search</span>
                <span className="text-xs text-gray-400 group-hover:text-gray-300">
                  {searchTerm ? `Filtering: "${searchTerm}"` : 'Search companies, roles, locations...'}
                </span>
              </div>
              <kbd className="font-mono text-[11px] bg-[#22232c] text-gray-300 px-1.5 py-0.5 rounded border border-[#292a36] font-medium">⌘K</kbd>
            </div>
          </div>

          {/* Quick Shortcuts & Mode Pill */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Mode badge */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border bg-[#1a1b22] border-[#292a36]">
              <span className={`w-2 h-2 rounded-full ${isCloudStatic ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span className="text-gray-300">{isCloudStatic ? 'GitHub Pages' : 'Local SQLite'}</span>
            </div>

            {/* Export / Import */}
            <div className="flex items-center gap-1">
              <input
                type="file"
                ref={importInputRef}
                onChange={handleImportDecisions}
                accept=".json"
                className="hidden"
              />
              <button
                onClick={() => importInputRef.current?.click()}
                title="Import decisions from tracker.json"
                className="px-2 py-1 rounded-md text-[11px] font-mono bg-[#1a1b22] hover:bg-[#252632] text-gray-300 hover:text-white border border-[#292a36] transition-colors"
              >
                Import
              </button>
              <button
                onClick={handleExportDecisions}
                title="Export decisions to JSON"
                className="px-2 py-1 rounded-md text-[11px] font-mono bg-[#1a1b22] hover:bg-[#252632] text-gray-300 hover:text-white border border-[#292a36] transition-colors"
              >
                Export
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-[#1a1b22] border border-[#292a36] px-2.5 py-1 rounded-md text-[11px] text-gray-300">
              <kbd className="font-mono bg-[#22232c] text-indigo-400 px-1 py-0.2 rounded border border-[#292a36]">J</kbd>
              <span className="text-gray-500">/</span>
              <kbd className="font-mono bg-[#22232c] text-indigo-400 px-1 py-0.2 rounded border border-[#292a36]">K</kbd>
              <span className="text-gray-400 ml-1">Navigate</span>
            </div>
            <div className="flex items-center gap-1.5 bg-[#1a1b22] border border-[#292a36] px-2.5 py-1 rounded-md text-[11px] text-gray-300">
              <kbd className="font-mono bg-[#22232c] text-emerald-400 px-1.5 py-0.2 rounded border border-[#292a36]">A</kbd>
              <span className="text-gray-400 ml-0.5">Apply</span>
            </div>
            <div className="flex items-center gap-1.5 bg-[#1a1b22] border border-[#292a36] px-2.5 py-1 rounded-md text-[11px] text-gray-300">
              <kbd className="font-mono bg-[#22232c] text-rose-400 px-1.5 py-0.2 rounded border border-[#292a36]">D</kbd>
              <span className="text-gray-400 ml-0.5">Dismiss</span>
            </div>
          </div>
        </header>

        {/* Feed Header / Filter Bar */}
        <div className="h-12 border-b border-[#292a36] px-6 bg-[#121318] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-sm font-semibold text-white tracking-tight capitalize">
              {queue === 'inbox' && 'Inbox (Pending)'}
              {queue === 'applied' && 'Applied Postings'}
              {queue === 'dismissed' && 'Dismissed Archive'}
              {queue === 'saved' && 'Saved Postings'}
            </h1>
            <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-[#1a1b22] text-indigo-300 border border-[#292a36]">
              {jobs.length.toLocaleString()} listings
            </span>
          </div>

          {/* Filter & Sort Controls */}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            {/* Sort Filter */}
            <div className="flex items-center gap-1.5 bg-[#1a1b22]/60 hover:bg-[#1a1b22] border border-[#292a36] px-2.5 py-1 rounded-md transition-colors">
              <span className="material-symbols-outlined text-[14px] text-gray-400">swap_vert</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as any)}
                aria-label="Sort postings by"
                className="bg-transparent text-[11px] text-gray-200 font-medium outline-none cursor-pointer"
              >
                <option value="newest" className="bg-[#1a1b22] text-white">Sort: Newest</option>
                <option value="company" className="bg-[#1a1b22] text-white">Sort: Company A-Z</option>
              </select>
            </div>

            {/* Track Filter */}
            <div className="flex items-center gap-1.5 bg-[#1a1b22]/60 hover:bg-[#1a1b22] border border-[#292a36] px-2.5 py-1 rounded-md transition-colors">
              <span className="material-symbols-outlined text-[14px] text-gray-400">filter_alt</span>
              <select
                value={trackFilter}
                onChange={(e) => setTrackFilter(e.target.value as any)}
                aria-label="Filter postings by role track"
                className="bg-transparent text-[11px] text-gray-200 font-medium outline-none cursor-pointer"
              >
                <option value="all" className="bg-[#1a1b22] text-white">Track: All Roles</option>
                <option value="pm" className="bg-[#1a1b22] text-white">Track: 📋 PM Only</option>
                <option value="swe" className="bg-[#1a1b22] text-white">Track: 💻 SWE Only</option>
              </select>
            </div>

            {/* Region Filter */}
            <div className="flex items-center gap-1.5 bg-[#1a1b22]/60 hover:bg-[#1a1b22] border border-[#292a36] px-2.5 py-1 rounded-md transition-colors">
              <span className="material-symbols-outlined text-[14px] text-gray-400">location_on</span>
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                aria-label="Filter postings by geographic region"
                className="bg-transparent text-[11px] text-gray-200 font-medium outline-none cursor-pointer"
              >
                <option value="all" className="bg-[#1a1b22] text-white">Region: All Regions</option>
                <option value="us" className="bg-[#1a1b22] text-white">🇺🇸 United States</option>
                <option value="ca" className="bg-[#1a1b22] text-white">🇨🇦 Canada</option>
                <option value="uk" className="bg-[#1a1b22] text-white">🇬🇧 United Kingdom</option>
                <option value="apac" className="bg-[#1a1b22] text-white">🌏 APAC</option>
                <option value="remote" className="bg-[#1a1b22] text-white">🌐 Remote</option>
              </select>
            </div>
          </div>
        </div>

        {/* Jobs Feed List Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5" id="jobs-list">
          {isLoading && (
            <div className="h-64 flex flex-col items-center justify-center text-gray-400 gap-3">
              <span className="material-symbols-outlined text-[32px] animate-spin text-indigo-400">sync</span>
              <span className="text-xs font-mono">Loading postings from jobs.db...</span>
            </div>
          )}

          {!isLoading && jobs.length === 0 && (
            <div className="h-64 flex flex-col items-center justify-center text-gray-500 gap-2 border border-dashed border-[#292a36] rounded-xl my-6">
              <span className="material-symbols-outlined text-[36px] text-gray-600">inbox</span>
              <span className="text-sm font-medium text-gray-300">No postings in this view</span>
              <span className="text-xs text-gray-500">
                {searchTerm ? 'Try adjusting your search query' : 'Switch queues or check back later!'}
              </span>
            </div>
          )}

          {!isLoading &&
            jobs.map((job) => {
              const isSelected = job.key === selectedKey;
              const flag = REGION_FLAGS[job.region] || '📍';
              const isPM = (job.track || 'pm').toLowerCase() === 'pm';
              const rawDate = job.posted_at || job.first_seen || '';
              const dateDisplay = rawDate.length >= 10 ? rawDate.slice(0, 10) : 'Recent';

              return (
                <div
                  key={job.key}
                  id={`job-${job.key}`}
                  onClick={() => setSelectedKey(job.key)}
                  onDoubleClick={() => handleOpenActivePortal(job)}
                  className={`relative p-3.5 rounded-xl border transition-all cursor-pointer group ${
                    isSelected
                      ? 'bg-[#1c1d27] border-indigo-500/80 shadow-lg shadow-indigo-950/20'
                      : 'bg-[#1a1b22] border-[#292a36] hover:border-[#383949] hover:bg-[#1e1f28]'
                  }`}
                >
                  {/* Active Selection Indicator Bar */}
                  {isSelected && (
                    <div className="absolute left-0 top-2 bottom-2 w-1 bg-indigo-500 rounded-r-md" />
                  )}

                  <div className="flex items-start justify-between gap-4">
                    {/* Left details */}
                    <div className="flex items-start gap-3.5 min-w-0">
                      {/* Monogram */}
                      <div
                        className={`w-9 h-9 rounded-lg ${getMonogramColor(
                          job.company
                        )} flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm`}
                      >
                        {job.company.charAt(0).toUpperCase()}
                      </div>

                      {/* Content */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-white hover:text-indigo-300 transition-colors">
                            {job.company}
                          </span>

                          {/* Track Badge */}
                          <span
                            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                              isPM
                                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            }`}
                          >
                            {isPM ? '📋 PM' : '💻 SWE'}
                          </span>

                          {/* Region Flag */}
                          <span className="text-xs" title={`Region: ${job.region.toUpperCase()}`}>
                            {flag}
                          </span>

                          {/* Date posted */}
                          <span className="text-[11px] font-mono text-gray-500 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">calendar_today</span>
                            {dateDisplay}
                          </span>

                          {/* Source */}
                          {job.source && (
                            <span className="text-[10px] font-mono text-gray-500 bg-[#22232c] px-1.5 py-0.2 rounded border border-[#292a36]">
                              {job.source}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <div className="text-[13px] font-medium text-gray-200 mt-1 truncate">
                          {job.title}
                        </div>

                        {/* Location */}
                        <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px] text-gray-500">location_on</span>
                          <span>{job.location || 'Location unstated'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Action Buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Apply Link Button */}
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                        >
                          <span>Apply</span>
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        </a>
                      )}

                      {/* Quick Action Pills */}
                      <button
                        title="Mark as Applied (A)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateStatus(job.key, 'applied', `Applied to ${job.company}!`);
                        }}
                        className="p-1.5 rounded-lg bg-[#22232c] hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-400 border border-[#292a36] hover:border-emerald-500/40 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      </button>

                      <button
                        title="Star / Save (S)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateStatus(job.key, 'saved', `Saved ${job.company}`);
                        }}
                        className="p-1.5 rounded-lg bg-[#22232c] hover:bg-amber-500/20 text-gray-400 hover:text-amber-400 border border-[#292a36] hover:border-amber-500/40 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">bookmark</span>
                      </button>

                      <button
                        title="Dismiss / Archive (D)"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateStatus(job.key, 'ignored', `Dismissed ${job.company}`);
                        }}
                        className="p-1.5 rounded-lg bg-[#22232c] hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-[#292a36] hover:border-rose-500/40 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">archive</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </main>

      {/* SEARCH COMMAND PALETTE MODAL (⌘K) */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-24 p-4">
          <div className="w-full max-w-xl bg-[#1a1b22] border border-[#292a36] rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b border-[#292a36] flex items-center gap-2.5">
              <span className="material-symbols-outlined text-[20px] text-indigo-400">search</span>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by company, role title, location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              />
              <button
                onClick={() => {
                  setSearchTerm('');
                  setIsSearchOpen(false);
                }}
                className="text-xs text-gray-400 hover:text-white px-1.5 py-0.5 rounded bg-[#22232c] border border-[#292a36]"
              >
                Esc
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              <div className="px-2 py-1 text-[11px] font-mono text-gray-400 uppercase tracking-wider">
                Matching Openings ({jobs.length})
              </div>
              {jobs.slice(0, 15).map((job) => (
                <div
                  key={job.key}
                  onClick={() => {
                    setSelectedKey(job.key);
                    setIsSearchOpen(false);
                    const el = document.getElementById(`job-${job.key}`);
                    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  }}
                  className="px-3 py-2 rounded-lg hover:bg-[#22232c] flex items-center justify-between cursor-pointer group"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white group-hover:text-indigo-300">
                      {job.company} — <span className="font-normal text-gray-300">{job.title}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-1">
                      <span>{REGION_FLAGS[job.region]}</span>
                      <span>{job.location}</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-gray-500">Jump</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* QUICK DETAIL INSPECTOR MODAL */}
      {inspectingJob && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#1a1b22] border border-[#292a36] rounded-xl shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-mono uppercase tracking-wider text-indigo-400">
                  {inspectingJob.track.toUpperCase()} Internship
                </span>
                <h2 className="text-xl font-bold text-white mt-1">{inspectingJob.company}</h2>
                <p className="text-sm text-gray-300 mt-0.5">{inspectingJob.title}</p>
              </div>
              <button
                onClick={() => setInspectingJob(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg bg-[#22232c]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-[#121318] p-3 rounded-lg border border-[#292a36]">
              <div>
                <span className="text-gray-500">Location:</span>
                <p className="text-white font-medium">{inspectingJob.location || 'Not specified'}</p>
              </div>
              <div>
                <span className="text-gray-500">Region:</span>
                <p className="text-white font-medium">
                  {REGION_FLAGS[inspectingJob.region]} {inspectingJob.region.toUpperCase()}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Date Posted:</span>
                <p className="text-white font-medium">{inspectingJob.posted_at || inspectingJob.first_seen}</p>
              </div>
              <div>
                <span className="text-gray-500">Source:</span>
                <p className="text-white font-medium">{inspectingJob.source}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#292a36]">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    handleUpdateStatus(inspectingJob.key, 'applied');
                    setInspectingJob(null);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium"
                >
                  Mark Applied
                </button>
                <button
                  onClick={() => {
                    handleUpdateStatus(inspectingJob.key, 'ignored');
                    setInspectingJob(null);
                  }}
                  className="bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 text-xs px-3 py-1.5 rounded-lg font-medium"
                >
                  Dismiss
                </button>
              </div>

              {inspectingJob.url && (
                <a
                  href={inspectingJob.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                >
                  <span>Open Application Portal</span>
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FLOATING TOAST NOTIFICATION CONTAINER */}
      {toast && (
        <div className="fixed bottom-5 right-6 z-50 pointer-events-auto bg-[#1a1b22] border border-[#292a36] text-white text-xs px-4 py-2.5 rounded-lg shadow-xl flex items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{toast.message}</span>
          </div>
          {toast.lastKey && (
            <button
              onClick={handleUndo}
              className="text-indigo-400 hover:text-indigo-300 font-mono text-[11px] flex items-center gap-1"
            >
              Undo <kbd className="bg-[#22232c] px-1 py-0.2 rounded border border-[#292a36] text-gray-300">Z</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
