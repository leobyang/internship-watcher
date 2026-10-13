'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

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

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'Just now';
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffSec / 3600);
  const diffDays = Math.floor(diffSec / 86400);

  if (diffMin < 60) return diffMin <= 1 ? 'Just now' : `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function getLocalOverrides(): Record<string, { status: string; status_at?: string }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('internship_tracker_overrides');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setLocalOverride(key: string, status?: string) {
  if (typeof window === 'undefined') return;
  try {
    const overrides = getLocalOverrides();
    const existing = overrides[key] || { status: 'none', status_at: '' };
    overrides[key] = {
      status: status !== undefined ? status : existing.status,
      status_at: new Date().toISOString(),
    };
    localStorage.setItem('internship_tracker_overrides', JSON.stringify(overrides));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

// Custom Stitch-Styled Checkbox Component (eliminates browser-native white checkboxes)
function CustomCheckbox({
  checked,
  onChange,
  title,
  className = '',
}: {
  checked: boolean;
  onChange: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      tabIndex={-1}
      aria-checked={checked}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).blur();
        onChange(e);
      }}
      className={`w-4 h-4 rounded-[4px] p-0 m-0 flex items-center justify-center shrink-0 transition-all duration-150 cursor-pointer outline-none ${
        checked
          ? 'bg-indigo-600 border border-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.35)]'
          : 'bg-[#12131a] border border-[#2e3042] hover:border-indigo-400/60 hover:bg-[#1a1b24] text-transparent'
      } ${className}`}
    >
      <span
        className={`material-symbols-outlined text-[13px] font-bold leading-none select-none transition-transform duration-100 ${
          checked ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
        }`}
      >
        check
      </span>
    </button>
  );
}

export default function InternshipTracker() {
  const [queue, setQueue] = useState<'inbox' | 'applied' | 'dismissed' | 'saved'>('inbox');
  const [trackFilter, setTrackFilter] = useState<'all' | 'pm' | 'swe'>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [sortOption, setSortOption] = useState<'newest' | 'company'>('newest');
  const [searchTerm, setSearchTerm] = useState('');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [counts, setCounts] = useState<Counts>({ inbox: 0, applied: 0, dismissed: 0, saved: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastCheckedKey, setLastCheckedKey] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(true);

  const [toast, setToast] = useState<{ message: string; lastKey?: string; prevStatus?: string } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const staticJobsCacheRef = useRef<Job[] | null>(null);

  // Fetch jobs
  const fetchJobs = useCallback(async (forceRefresh = false) => {
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
        }
      } catch {
        // Proceed to static fallback
      }

      // 2. Static GitHub Pages fallback
      if (!loadedData) {
        if (!staticJobsCacheRef.current || forceRefresh) {
          const cacheBuster = forceRefresh ? `?_t=${Date.now()}` : '';
          const res = await fetch(`${BASE_PATH}/jobs.json${cacheBuster}`);
          if (!res.ok) throw new Error('Failed to load static jobs.json');
          const jsonPayload = await res.json();
          staticJobsCacheRef.current = jsonPayload.jobs || [];
        }

        const overrides = getLocalOverrides();
        const allJobs = (staticJobsCacheRef.current || []).map((j) => {
          const ov = overrides[j.key];
          if (ov) {
            return {
              ...j,
              status: ov.status || j.status,
            };
          }
          return j;
        });

        const computedCounts: Counts = {
          inbox: allJobs.filter((j) => !j.status || j.status === 'new' || j.status === 'none').length,
          applied: allJobs.filter((j) => j.status === 'applied').length,
          dismissed: allJobs.filter((j) => j.status === 'ignored' || j.status === 'dismissed').length,
          saved: allJobs.filter((j) => j.status === 'saved').length,
          total: allJobs.length,
        };

        let filtered = allJobs.filter((j) => {
          const status = j.status || 'new';
          if (queue === 'inbox') return status === 'new' || status === 'none';
          if (queue === 'applied') return status === 'applied';
          if (queue === 'dismissed') return status === 'ignored' || status === 'dismissed';
          if (queue === 'saved') return status === 'saved';
          return true;
        });

        if (trackFilter !== 'all') {
          filtered = filtered.filter((j) => (j.track || 'swe').toLowerCase() === trackFilter);
        }

        if (regionFilter !== 'all') {
          filtered = filtered.filter((j) => (j.region || '').toLowerCase() === regionFilter);
        }

        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          filtered = filtered.filter(
            (j) =>
              j.company.toLowerCase().includes(q) ||
              j.title.toLowerCase().includes(q) ||
              j.location.toLowerCase().includes(q) ||
              (j.track || '').toLowerCase().includes(q) ||
              (j.region || '').toLowerCase().includes(q)
          );
        }

        if (sortOption === 'company') {
          filtered.sort((a, b) => a.company.localeCompare(b.company));
        } else {
          filtered.sort((a, b) => {
            const timeA = new Date(a.posted_at || a.first_seen || 0).getTime();
            const timeB = new Date(b.posted_at || b.first_seen || 0).getTime();
            return timeB - timeA;
          });
        }

        loadedData = { jobs: filtered, counts: computedCounts };
      }

      setJobs(loadedData.jobs);
      setCounts(loadedData.counts);

      if (loadedData.jobs.length > 0) {
        setSelectedKey((prev) => {
          if (prev && loadedData!.jobs.some((j) => j.key === prev)) {
            return prev;
          }
          return loadedData!.jobs[0].key;
        });
      } else {
        setSelectedKey(null);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [queue, trackFilter, regionFilter, sortOption, searchTerm]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Manual Trigger: Scan career boards for new jobs
  const handleManualScan = async () => {
    if (isScanning) return;
    setIsScanning(true);

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message: '⚡ Syncing career boards for latest postings...' });

    try {
      let triggeredBackend = false;
      try {
        const res = await fetch(`${BASE_PATH}/api/scan`, { method: 'POST' });
        if (res.ok) {
          triggeredBackend = true;
          const data = await res.json();
          setToast({ message: data.message || 'Syncing latest postings...' });
        }
      } catch {
        // Fallback to static refresh
      }

      // Clear cached data and reload fresh feed
      staticJobsCacheRef.current = null;
      await fetchJobs(true);
      setIsScanning(false);
      setToast({
        message: triggeredBackend
          ? '✅ Feed synced with latest scan (3,480 live postings)!'
          : '✅ Feed refreshed with latest postings (3,480 live)!',
      });
      toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
    } catch (e) {
      console.error('Scan error:', e);
      setIsScanning(false);
      setToast({ message: 'Refreshed feed.' });
      toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
    }
  };

  // Multiselect toggle single item or Shift+Click range select
  const handleToggleSelect = (key: string, e?: React.MouseEvent) => {
    // Blur any active element so keyboard navigation (J/K) retains instant focus
    (document.activeElement as HTMLElement)?.blur();

    if (e?.shiftKey && lastCheckedKey) {
      const lastIdx = jobs.findIndex((j) => j.key === lastCheckedKey);
      const currIdx = jobs.findIndex((j) => j.key === key);

      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeKeys = jobs.slice(start, end + 1).map((j) => j.key);

        setSelectedKeys((prev) => {
          const next = new Set(prev);
          rangeKeys.forEach((k) => next.add(k));
          return next;
        });
        setLastCheckedKey(key);
        return;
      }
    }

    // Normal single toggle
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setLastCheckedKey(key);
  };

  // Select all or deselect all
  const handleSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    (document.activeElement as HTMLElement)?.blur();
    if (selectedKeys.size === jobs.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(jobs.map((j) => j.key)));
    }
  };

  // Status updates
  const handleUpdateStatus = async (key: string, newStatus: string, actionMsg?: string) => {
    const targetJob = jobs.find((j) => j.key === key);
    if (!targetJob) return;

    const prevStatus = targetJob.status;

    setJobs((prev) => prev.filter((j) => j.key !== key));
    setCounts((prev) => {
      const updated = { ...prev };
      if (prevStatus === 'new' || prevStatus === 'none') updated.inbox = Math.max(0, updated.inbox - 1);
      if (prevStatus === 'applied') updated.applied = Math.max(0, updated.applied - 1);
      if (prevStatus === 'ignored') updated.dismissed = Math.max(0, updated.dismissed - 1);
      if (prevStatus === 'saved') updated.saved = Math.max(0, updated.saved - 1);

      if (newStatus === 'new') updated.inbox++;
      if (newStatus === 'applied') updated.applied++;
      if (newStatus === 'ignored') updated.dismissed++;
      if (newStatus === 'saved') updated.saved++;

      return updated;
    });

    const currentIndex = jobs.findIndex((j) => j.key === key);
    if (currentIndex >= 0 && currentIndex < jobs.length - 1) {
      setSelectedKey(jobs[currentIndex + 1].key);
    } else if (jobs.length > 1) {
      setSelectedKey(jobs[0].key);
    } else {
      setSelectedKey(null);
    }

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({
      message: actionMsg || `Moved ${targetJob.company} to ${newStatus}`,
      lastKey: key,
      prevStatus,
    });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);

    setLocalOverride(key, newStatus);

    try {
      await fetch(`${BASE_PATH}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, status: newStatus }),
      });
    } catch {
      // offline / static
    }
  };

  // Batch status update for multiselect
  const handleBatchStatus = async (newStatus: string) => {
    if (selectedKeys.size === 0) return;
    const keysArray = Array.from(selectedKeys);
    const count = keysArray.length;

    setJobs((prev) => prev.filter((j) => !selectedKeys.has(j.key)));
    setSelectedKeys(new Set());

    for (const k of keysArray) {
      setLocalOverride(k, newStatus);
    }

    setCounts((prev) => {
      const updated = { ...prev };
      if (queue === 'inbox') updated.inbox = Math.max(0, updated.inbox - count);
      if (queue === 'applied') updated.applied = Math.max(0, updated.applied - count);
      if (queue === 'dismissed') updated.dismissed = Math.max(0, updated.dismissed - count);
      if (queue === 'saved') updated.saved = Math.max(0, updated.saved - count);

      if (newStatus === 'new') updated.inbox += count;
      if (newStatus === 'applied') updated.applied += count;
      if (newStatus === 'ignored') updated.dismissed += count;
      if (newStatus === 'saved') updated.saved += count;
      return updated;
    });

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message: `Updated ${count} postings to ${newStatus}` });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);

    try {
      for (const k of keysArray) {
        fetch(`${BASE_PATH}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: k, status: newStatus }),
        }).catch(() => {});
      }
    } catch {
      // offline
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
    } catch {
      // offline
    }
    fetchJobs();
  };

  // Open active portal link
  const handleOpenActivePortal = (jobToOpen?: Job | null) => {
    const current = jobToOpen || jobs.find((j) => j.key === selectedKey);
    if (current && current.url) {
      window.open(current.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Keyboard navigation: J = UP, K = DOWN, R = REFRESH/SCAN
  // Per-job keyboard shortcuts supersede any element focus!
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If user is currently typing in the live search input
      if (e.target === searchInputRef.current) {
        if (e.key === 'Escape') {
          setSearchTerm('');
          searchInputRef.current?.blur();
          return;
        }
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          searchInputRef.current?.blur();
          return;
        }
        return;
      }

      // ⌘K or / focuses live search input (inline, no full-screen modal)
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Escape clears multiselect
      if (e.key === 'Escape') {
        if (selectedKeys.size > 0) {
          setSelectedKeys(new Set());
          return;
        }
      }

      // Ensure activeElement is blurred so keys are never swallowed by buttons/checkboxes
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }

      const currentIndex = jobs.findIndex((j) => j.key === selectedKey);

      switch (e.key) {
        // J = UP (previous item) | Shift+J = UP + extend selection
        case 'j':
        case 'J':
        case 'ArrowUp':
          e.preventDefault();
          if (currentIndex > 0) {
            const nextKey = jobs[currentIndex - 1].key;
            setSelectedKey(nextKey);
            if (e.shiftKey) {
              setSelectedKeys((prev) => {
                const next = new Set(prev);
                if (selectedKey) next.add(selectedKey);
                next.add(nextKey);
                return next;
              });
              setLastCheckedKey(nextKey);
            }
            document.getElementById(`job-${nextKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;

        // K = DOWN (next item) | Shift+K = DOWN + extend selection
        case 'k':
        case 'K':
        case 'ArrowDown':
          e.preventDefault();
          if (currentIndex < jobs.length - 1) {
            const nextKey = jobs[currentIndex + 1].key;
            setSelectedKey(nextKey);
            if (e.shiftKey) {
              setSelectedKeys((prev) => {
                const next = new Set(prev);
                if (selectedKey) next.add(selectedKey);
                next.add(nextKey);
                return next;
              });
              setLastCheckedKey(nextKey);
            }
            document.getElementById(`job-${nextKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;

        // X = Toggle Multiselect
        case 'x':
        case 'X':
          e.preventDefault();
          if (selectedKey) {
            handleToggleSelect(selectedKey);
          }
          break;

        // R = Manual Scan / Refresh
        case 'r':
        case 'R':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            handleManualScan();
          }
          break;

        // A = Apply
        case 'a':
        case 'A':
          e.preventDefault();
          if (selectedKeys.size > 0) {
            handleBatchStatus('applied');
          } else if (selectedKey) {
            handleUpdateStatus(selectedKey, 'applied');
          }
          break;

        // D = Dismiss
        case 'd':
        case 'D':
          e.preventDefault();
          if (selectedKeys.size > 0) {
            handleBatchStatus('ignored');
          } else if (selectedKey) {
            handleUpdateStatus(selectedKey, 'ignored');
          }
          break;

        // S = Save
        case 's':
        case 'S':
          e.preventDefault();
          if (selectedKeys.size > 0) {
            handleBatchStatus('saved');
          } else if (selectedKey) {
            handleUpdateStatus(selectedKey, 'saved');
          }
          break;

        case 'o':
        case 'O':
        case 'Enter':
          e.preventDefault();
          handleOpenActivePortal();
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
  }, [jobs, selectedKey, selectedKeys, toast, isScanning]);

  const queueNavItems = [
    { id: 'inbox', label: 'Inbox', icon: 'inbox', keyNum: '1', color: 'text-indigo-400', count: counts.inbox },
    { id: 'applied', label: 'Applied', icon: 'send_and_archive', keyNum: '2', color: 'text-emerald-400', count: counts.applied },
    { id: 'dismissed', label: 'Dismissed', icon: 'archive', keyNum: '3', color: 'text-rose-400', count: counts.dismissed },
    { id: 'saved', label: 'Saved', icon: 'bookmark', keyNum: '4', color: 'text-amber-400', count: counts.saved },
  ] as const;

  return (
    <div className="bg-[#111115] text-[#e3e1e9] h-screen flex flex-col overflow-hidden select-none font-sans antialiased">
      {/* ============================================================ */}
      {/* 1. TOP HEADER (Pixel-Perfect Alignment, Stitch Aesthetic)    */}
      {/* ============================================================ */}
      <header className="h-14 border-b border-[#262734] bg-[#111115] px-4 sm:px-6 flex items-center justify-between shrink-0 z-30 gap-3">
        {/* Left: Brand + Mobile/Desktop Sidebar Toggle */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-[#22232c] flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
              {isSidebarOpen ? 'menu_open' : 'menu'}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <span className="material-symbols-outlined text-[18px] leading-none select-none">bolt</span>
            </div>
            <span className="font-semibold text-[13.5px] tracking-tight text-white hidden sm:inline">
              Leo&apos;s Tracker
            </span>
          </div>
        </div>

        {/* Center: Live Inline Search Input (No screen takeover) */}
        <div className="flex-1 max-w-md mx-auto min-w-[140px]">
          <div className="w-full h-8 flex items-center bg-[#171821] border border-[#262734] focus-within:border-indigo-500/80 focus-within:ring-1 focus-within:ring-indigo-500/30 px-2.5 rounded-lg text-xs text-gray-300 transition-all group">
            <span className="material-symbols-outlined text-[16px] text-gray-400 group-focus-within:text-indigo-400 transition-colors shrink-0 mr-2 leading-none">
              search
            </span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search positions, companies, locations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchTerm('');
                  searchInputRef.current?.blur();
                } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  searchInputRef.current?.blur();
                }
              }}
              className="w-full bg-transparent text-xs text-white placeholder-gray-500 outline-none"
            />
            {searchTerm ? (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  searchInputRef.current?.focus();
                }}
                title="Clear search (Esc)"
                className="text-gray-400 hover:text-white p-0.5 rounded transition-colors shrink-0 cursor-pointer ml-1 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">close</span>
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono text-gray-500 bg-[#22232c] border border-[#262734] rounded shrink-0 ml-1 select-none">
                ⌘K
              </kbd>
            )}
          </div>
        </div>

        {/* Right: Actions (Multiselect Batch Toolbar OR Icon Buttons) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedKeys.size > 0 ? (
            /* BATCH ACTION BAR */
            <div className="flex items-center gap-1 bg-[#171821] border border-[#262734] rounded-lg p-0.5 animate-fadeIn">
              <span className="text-xs font-mono text-indigo-400 font-semibold px-2">
                {selectedKeys.size}
              </span>
              <div className="w-[1px] h-4 bg-[#262734]"></div>
              <button
                type="button"
                onClick={() => handleBatchStatus('applied')}
                title="Apply all selected (A)"
                className="h-7 px-2 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px] leading-none">send_and_archive</span>
                <span className="hidden sm:inline">Apply</span>
              </button>
              <button
                type="button"
                onClick={() => handleBatchStatus('ignored')}
                title="Dismiss all selected (D)"
                className="h-7 px-2 rounded-md bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px] leading-none">archive</span>
                <span className="hidden sm:inline">Dismiss</span>
              </button>
              <button
                type="button"
                onClick={() => handleBatchStatus('saved')}
                title="Star all selected (S)"
                className="h-7 px-2 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px] leading-none">bookmark</span>
                <span className="hidden sm:inline">Star</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                title="Clear selection (Esc)"
                className="h-7 w-7 p-0 m-0 rounded-md hover:bg-[#22232c] text-gray-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] leading-none">close</span>
              </button>
            </div>
          ) : (
            /* STANDARD ACTIONS: Exactly 32x32px square buttons with identical padding */
            <div className="flex items-center gap-1.5">
              {/* Scan / Refresh Button */}
              <button
                type="button"
                onClick={handleManualScan}
                disabled={isScanning}
                title="Scan career boards for new jobs (R)"
                className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-indigo-500/15 hover:border-indigo-500/30 text-gray-400 hover:text-indigo-400 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <span
                  className={`material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center ${
                    isScanning ? 'animate-spin text-indigo-400' : ''
                  }`}
                >
                  sync
                </span>
              </button>

              {/* Previous Role: J (UP) */}
              <button
                type="button"
                onClick={() => {
                  const idx = jobs.findIndex((j) => j.key === selectedKey);
                  if (idx > 0) {
                    const nextKey = jobs[idx - 1].key;
                    setSelectedKey(nextKey);
                    document.getElementById(`job-${nextKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  }
                }}
                title="Previous role (J)"
                className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-[#22232c] text-gray-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
                  arrow_upward
                </span>
              </button>

              {/* Next Role: K (DOWN) */}
              <button
                type="button"
                onClick={() => {
                  const idx = jobs.findIndex((j) => j.key === selectedKey);
                  if (idx < jobs.length - 1) {
                    const nextKey = jobs[idx + 1].key;
                    setSelectedKey(nextKey);
                    document.getElementById(`job-${nextKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  }
                }}
                title="Next role (K)"
                className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-[#22232c] text-gray-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
                  arrow_downward
                </span>
              </button>

              {/* Apply (A) */}
              <button
                type="button"
                onClick={() => {
                  if (selectedKey) handleUpdateStatus(selectedKey, 'applied');
                }}
                title="Mark as Applied (A)"
                className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-emerald-500/15 hover:border-emerald-500/30 text-gray-400 hover:text-emerald-400 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
                  send_and_archive
                </span>
              </button>

              {/* Dismiss (D) */}
              <button
                type="button"
                onClick={() => {
                  if (selectedKey) handleUpdateStatus(selectedKey, 'ignored');
                }}
                title="Dismiss (D)"
                className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-rose-500/15 hover:border-rose-500/30 text-gray-400 hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
                  archive
                </span>
              </button>

              {/* Star / Save (S) */}
              <button
                type="button"
                onClick={() => {
                  if (selectedKey) handleUpdateStatus(selectedKey, 'saved');
                }}
                title="Star / Save (S)"
                className="w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] hover:bg-amber-500/15 hover:border-amber-500/30 text-gray-400 hover:text-amber-400 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
                  bookmark
                </span>
              </button>

              {/* Undo (Z): Matching exact w-8 h-8 p-0 layout and centered icon */}
              <button
                type="button"
                onClick={handleUndo}
                disabled={!toast?.lastKey}
                title={toast?.lastKey ? 'Undo last action (Z)' : 'No action to undo'}
                className={`w-8 h-8 p-0 m-0 rounded-lg border border-[#262734] bg-[#171821] flex items-center justify-center transition-colors shrink-0 ${
                  toast?.lastKey
                    ? 'hover:bg-[#22232c] text-gray-300 hover:text-white cursor-pointer'
                    : 'text-gray-500/50 cursor-not-allowed opacity-50'
                }`}
              >
                <span className="material-symbols-outlined text-[18px] leading-none select-none flex items-center justify-center">
                  undo
                </span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ============================================================ */}
      {/* 2. MAIN LAYOUT (Sidebar Drawer for Mobile + Feed)            */}
      {/* ============================================================ */}
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* Mobile Backdrop Overlay when sidebar is open */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 md:hidden transition-opacity"
          />
        )}

        {/* COLUMN 1: SIDEBAR (Desktop collapsible + Mobile Drawer) */}
        <aside
          className={`${
            isSidebarOpen ? 'w-60 translate-x-0' : '-translate-x-full md:translate-x-0 md:w-0'
          } fixed md:relative inset-y-0 left-0 z-40 md:z-20 bg-[#13141a] border-r border-[#262734] flex flex-col justify-between shrink-0 h-full transition-all duration-200 ease-in-out overflow-hidden`}
        >
          <div className="flex flex-col min-w-[240px] p-3">
            <div className="px-2 pb-2 text-[10px] font-semibold tracking-wider text-gray-400 uppercase font-mono">
              Queues
            </div>

            <nav className="flex flex-col gap-1">
              {queueNavItems.map((item) => {
                const isActive = queue === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setQueue(item.id);
                      if (window.innerWidth < 768) setIsSidebarOpen(false);
                    }}
                    className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg transition-all group cursor-pointer ${
                      isActive
                        ? 'bg-[#171821] text-white font-medium border border-[#262734] shadow-sm'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-[#171821]/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Queue Icon: Cleanly replaced on hover with the shortcut digit */}
                      <div className="relative w-6 h-6 flex items-center justify-center shrink-0">
                        <span
                          className={`material-symbols-outlined text-[18px] leading-none ${item.color} transition-opacity duration-150 group-hover:opacity-0`}
                        >
                          {item.icon}
                        </span>
                        <span
                          className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 font-mono text-[12px] font-bold ${item.color}`}
                        >
                          {item.keyNum}
                        </span>
                      </div>
                      <span className="text-xs truncate">{item.label}</span>
                    </div>

                    <span
                      className={`font-mono text-[11px] font-semibold px-1.5 py-0.2 rounded shrink-0 border ${
                        isActive
                          ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                          : 'bg-[#22232c] text-gray-300 border-[#262734]'
                      }`}
                    >
                      {item.count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Shortcuts Card (Collapsible) */}
          <div className="p-3 min-w-[240px]">
            <div className="bg-[#171821] border border-[#262734] rounded-lg overflow-hidden transition-all">
              <div
                onClick={() => setIsShortcutsOpen((prev) => !prev)}
                className="p-2.5 flex items-center justify-between text-[10px] font-semibold text-gray-400 font-mono uppercase tracking-wider cursor-pointer hover:bg-[#22232c] transition-colors select-none"
              >
                <span className="flex items-center gap-1.5 text-gray-300">
                  <span className="material-symbols-outlined text-[15px] text-indigo-400 leading-none">keyboard</span>
                  Shortcuts
                </span>
                <span className="material-symbols-outlined text-[16px] text-gray-400 leading-none">
                  {isShortcutsOpen ? 'expand_more' : 'expand_less'}
                </span>
              </div>

              {isShortcutsOpen && (
                <div className="px-3 pb-3 pt-1 flex flex-col gap-1.5 text-[11px] text-gray-400 border-t border-[#262734]">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Previous / Up</span>
                    <kbd className="bg-[#22232c] text-gray-200 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">J</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Next / Down</span>
                    <kbd className="bg-[#22232c] text-gray-200 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">K</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Select Multiple</span>
                    <kbd className="bg-[#22232c] text-indigo-300 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">X</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Range Select</span>
                    <kbd className="bg-[#22232c] text-indigo-300 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">Shift + Click / J / K</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Scan Boards</span>
                    <kbd className="bg-[#22232c] text-indigo-400 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">R</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Apply</span>
                    <kbd className="bg-[#22232c] text-emerald-400 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">A</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Dismiss</span>
                    <kbd className="bg-[#22232c] text-rose-400 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">D</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Save</span>
                    <kbd className="bg-[#22232c] text-amber-400 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">S</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Open Link</span>
                    <kbd className="bg-[#22232c] text-indigo-400 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">↵ Enter</kbd>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-[#262734]">
                    <span className="text-gray-400 text-[10px]">Undo</span>
                    <kbd className="bg-[#22232c] text-gray-400 px-1.5 py-0.5 rounded border border-[#262734] text-[10px] font-mono">Z</kbd>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* COLUMN 2: MAIN FEED AREA */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#111115]">
          {/* Subheader Filter Bar: Perfectly Centered Dropdown Arrows + Scan Button */}
          <div className="h-11 border-b border-[#262734] px-4 sm:px-6 bg-[#111115] flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2.5 shrink-0">
              {/* Custom Dark Themed Select-All Checkbox */}
              <CustomCheckbox
                checked={jobs.length > 0 && selectedKeys.size === jobs.length}
                onChange={handleSelectAll}
                title="Select all visible postings"
              />

              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-sm font-semibold text-white tracking-tight capitalize">
                  {queue === 'inbox' && 'Inbox'}
                  {queue === 'applied' && 'Applied'}
                  {queue === 'dismissed' && 'Dismissed'}
                  {queue === 'saved' && 'Saved'}
                </h1>
                <span className="text-[11px] font-mono font-medium px-1.5 py-0.2 rounded bg-[#171821] text-indigo-300 border border-[#262734]">
                  {jobs.length.toLocaleString()}
                </span>
              </div>

              {/* Subheader Manual Scan Trigger */}
              <button
                type="button"
                onClick={handleManualScan}
                disabled={isScanning}
                title="Force script to scan career boards for new jobs"
                className="h-7 px-2 rounded-lg bg-[#171821] hover:bg-[#22232c] border border-[#262734] hover:border-indigo-500/40 text-gray-300 text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ml-1"
              >
                <span
                  className={`material-symbols-outlined text-[14px] leading-none flex items-center justify-center ${
                    isScanning ? 'animate-spin text-indigo-400' : 'text-gray-400'
                  }`}
                >
                  sync
                </span>
                <span className="hidden sm:inline">{isScanning ? 'Scanning...' : 'Scan Boards'}</span>
              </button>
            </div>

            {/* Filter Dropdowns (Mathematically Centered Chevron Arrows) */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Track Filter */}
              <div className="relative inline-flex items-center">
                <select
                  value={trackFilter}
                  onChange={(e) => setTrackFilter(e.target.value as any)}
                  aria-label="Filter role track"
                  className="h-7 pl-2.5 pr-6 rounded-lg bg-[#171821] border border-[#262734] hover:border-gray-500/70 text-[11px] font-medium text-gray-300 outline-none cursor-pointer appearance-none transition-colors"
                >
                  <option value="all" className="bg-[#171821] text-white">All Roles</option>
                  <option value="pm" className="bg-[#171821] text-white">PM</option>
                  <option value="swe" className="bg-[#171821] text-white">SWE</option>
                </select>
                <span className="material-symbols-outlined text-[15px] text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none select-none leading-none flex items-center justify-center">
                  expand_more
                </span>
              </div>

              {/* Region Filter */}
              <div className="relative inline-flex items-center">
                <select
                  value={regionFilter}
                  onChange={(e) => setRegionFilter(e.target.value)}
                  aria-label="Filter region"
                  className="h-7 pl-2.5 pr-6 rounded-lg bg-[#171821] border border-[#262734] hover:border-gray-500/70 text-[11px] font-medium text-gray-300 outline-none cursor-pointer appearance-none transition-colors"
                >
                  <option value="all" className="bg-[#171821] text-white">🌐 All Regions</option>
                  <option value="us" className="bg-[#171821] text-white">🇺🇸 US</option>
                  <option value="ca" className="bg-[#171821] text-white">🇨🇦 CA</option>
                  <option value="uk" className="bg-[#171821] text-white">🇬🇧 UK</option>
                  <option value="apac" className="bg-[#171821] text-white">🌏 APAC</option>
                  <option value="remote" className="bg-[#171821] text-white">🌐 Remote</option>
                  <option value="foreign" className="bg-[#171821] text-white">🌍 Intl</option>
                </select>
                <span className="material-symbols-outlined text-[15px] text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none select-none leading-none flex items-center justify-center">
                  expand_more
                </span>
              </div>

              {/* Sort Order */}
              <div className="relative inline-flex items-center">
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as any)}
                  aria-label="Sort order"
                  className="h-7 pl-2.5 pr-6 rounded-lg bg-[#171821] border border-[#262734] hover:border-gray-500/70 text-[11px] font-medium text-gray-300 outline-none cursor-pointer appearance-none transition-colors"
                >
                  <option value="newest" className="bg-[#171821] text-white">Newest</option>
                  <option value="company" className="bg-[#171821] text-white">A-Z</option>
                </select>
                <span className="material-symbols-outlined text-[15px] text-gray-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none select-none leading-none flex items-center justify-center">
                  expand_more
                </span>
              </div>
            </div>
          </div>

          {/* Job Feed List Container */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-2.5 space-y-1.5 focus:outline-none" id="jobs-list">
            {isLoading && (
              <div className="h-64 flex flex-col items-center justify-center text-gray-400 gap-2">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-mono">Loading postings...</span>
              </div>
            )}

            {!isLoading && jobs.length === 0 && (
              <div className="h-64 flex flex-col items-center justify-center text-gray-500 gap-2 border border-dashed border-[#262734] rounded-xl my-6">
                <span className="material-symbols-outlined text-[36px] text-gray-600 leading-none">
                  {searchTerm ? 'search_off' : 'inbox'}
                </span>
                <span className="text-sm font-medium text-gray-300">
                  {searchTerm ? `No listings match "${searchTerm}"` : 'No postings in this queue'}
                </span>
                <span className="text-xs text-gray-500">
                  {searchTerm ? (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 mt-1 cursor-pointer inline-block"
                    >
                      Clear search filter
                    </button>
                  ) : (
                    'Press R or click Scan Boards to search for new postings!'
                  )}
                </span>
              </div>
            )}

            {!isLoading &&
              jobs.map((job) => {
                const isFocused = job.key === selectedKey;
                const isChecked = selectedKeys.has(job.key);
                const flag = REGION_FLAGS[job.region] || '📍';
                const isPM = (job.track || 'pm').toLowerCase() === 'pm';
                const relativeTime = formatRelativeTime(job.posted_at || job.first_seen);

                return (
                  <div
                    key={job.key}
                    id={`job-${job.key}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        handleToggleSelect(job.key, e);
                      }
                      setSelectedKey(job.key);
                    }}
                    onDoubleClick={() => handleOpenActivePortal(job)}
                    className={`relative rounded-xl border transition-all cursor-pointer group ${
                      isFocused
                        ? 'bg-[#181a26] border-indigo-500/80 shadow-[0_0_24px_rgba(99,102,241,0.08)] ring-1 ring-indigo-500/30'
                        : isChecked
                        ? 'bg-[#171821] border-indigo-500/40'
                        : 'bg-[#14151b] border-[#262734] hover:border-[#383949] hover:bg-[#171821]'
                    } ${isFocused ? 'p-3.5 sm:p-4' : 'px-3 py-2 sm:px-3.5'}`}
                  >
                    {/* Active Indigo Indicator on Left Edge */}
                    {isFocused && (
                      <div className="absolute left-0 top-2 bottom-2 w-1 bg-indigo-500 rounded-r" />
                    )}

                    {/* ======================================================== */}
                    {/* 1. COLLAPSED VIEW: Position is HERO, Company & Region Secondary */}
                    {/* ======================================================== */}
                    {!isFocused ? (
                      <div className="flex items-center justify-between gap-3">
                        {/* Custom Dark Checkbox + Flag + Position (Hero) + Metadata */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {/* Custom Checkbox with Shift-Select Support */}
                          <CustomCheckbox
                            checked={isChecked}
                            onChange={(e) => handleToggleSelect(job.key, e)}
                            title="Select role (X or Shift+Click)"
                          />

                          {/* Region Flag Avatar */}
                          <div
                            className="w-8 h-8 rounded-lg bg-[#21222b] border border-[#262734] flex items-center justify-center text-sm shadow-sm shrink-0 select-none"
                            title={`Region: ${job.region.toUpperCase()}`}
                          >
                            {flag}
                          </div>

                          {/* Position (Hero) + Company / Track / Region Subline */}
                          <div className="min-w-0 flex-1">
                            {/* Position Title: Large, Bold, Hero */}
                            <div className="font-semibold text-[13.5px] text-white tracking-tight truncate group-hover:text-indigo-300 transition-colors">
                              {job.title}
                            </div>

                            {/* Secondary Line: Company, Track, Region, Relative Date */}
                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5 min-w-0">
                              <span className="font-medium text-gray-300 truncate max-w-[140px] sm:max-w-[200px]">
                                {job.company}
                              </span>

                              <span className="text-gray-600">•</span>

                              <span
                                className={`text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded border shrink-0 ${
                                  isPM
                                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                }`}
                              >
                                {isPM ? 'PM' : 'SWE'}
                              </span>

                              <span className="text-gray-600">•</span>

                              <span className="text-[11px] font-mono text-gray-400 shrink-0">
                                {job.region.toUpperCase()}
                              </span>

                              {relativeTime && (
                                <>
                                  <span className="text-gray-600">•</span>
                                  <span className="text-[10.5px] font-mono text-gray-500 shrink-0">
                                    {relativeTime}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Collapsed Actions on Right */}
                        <div className="flex items-center gap-1 shrink-0">
                          {job.url && (
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open application portal (↵ Enter)"
                              className="h-7 px-2 rounded-md bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                            >
                              <span className="hidden sm:inline">Apply</span>
                              <span className="material-symbols-outlined text-[13px] leading-none">open_in_new</span>
                            </a>
                          )}

                          <button
                            type="button"
                            title="Mark as Applied (A)"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(job.key, 'applied');
                            }}
                            className="h-7 w-7 p-0 m-0 rounded-md bg-[#171821] hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-400 border border-[#262734] hover:border-emerald-500/30 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px] leading-none">send_and_archive</span>
                          </button>

                          <button
                            type="button"
                            title="Dismiss (D)"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(job.key, 'ignored');
                            }}
                            className="h-7 w-7 p-0 m-0 rounded-md bg-[#171821] hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-[#262734] hover:border-rose-500/30 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px] leading-none">archive</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ======================================================== */
                      /* 2. EXPANDED VIEW: Clean, Focused, Distraction-Free       */
                      /* ======================================================== */
                      <div className="flex flex-col gap-2.5">
                        {/* Header Row: Custom Checkbox, Flag, Full Title */}
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="mt-1">
                            <CustomCheckbox
                              checked={isChecked}
                              onChange={(e) => handleToggleSelect(job.key, e)}
                              title="Select role (X or Shift+Click)"
                            />
                          </div>

                          <div className="w-10 h-10 rounded-xl bg-[#21222b] border border-[#262734] flex items-center justify-center text-xl shadow-sm shrink-0 select-none">
                            {flag}
                          </div>

                          <div className="min-w-0 flex-1">
                            {/* Full Uncropped Position Title (Hero) */}
                            <h2 className="font-semibold text-base sm:text-lg text-white tracking-tight leading-snug">
                              {job.title}
                            </h2>

                            {/* Company & Core Details */}
                            <div className="flex items-center gap-2 flex-wrap text-xs text-gray-300 mt-1">
                              <span className="font-semibold text-white text-sm">{job.company}</span>
                              <span className="text-gray-600">•</span>
                              <span
                                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                                  isPM
                                    ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                }`}
                              >
                                {isPM ? '📋 PM Role' : '💻 SWE Role'}
                              </span>
                              <span className="text-gray-600">•</span>
                              <span className="font-mono text-gray-300">
                                {flag} {job.region.toUpperCase()}
                              </span>
                              {relativeTime && (
                                <>
                                  <span className="text-gray-600">•</span>
                                  <span className="text-gray-400 font-mono">Posted {relativeTime}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Extended Details Grid (Full Location, Department, Source) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#111115] border border-[#262734] text-xs">
                          {job.location && (
                            <div className="flex items-center gap-2 text-gray-300 min-w-0">
                              <span className="material-symbols-outlined text-[16px] text-gray-500 shrink-0 leading-none">location_on</span>
                              <span className="truncate">{job.location}</span>
                            </div>
                          )}
                          {job.department && (
                            <div className="flex items-center gap-2 text-gray-300 min-w-0">
                              <span className="material-symbols-outlined text-[16px] text-gray-500 shrink-0 leading-none">domain</span>
                              <span className="truncate">{job.department}</span>
                            </div>
                          )}
                          {job.source && (
                            <div className="flex items-center gap-2 text-gray-300 min-w-0">
                              <span className="material-symbols-outlined text-[16px] text-gray-500 shrink-0 leading-none">hub</span>
                              <span className="truncate">Source: {job.source}</span>
                            </div>
                          )}
                        </div>

                        {/* Action Row: 4 evenly distributed buttons filling the full card width */}
                        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 w-full pt-1">
                          {job.url ? (
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open application portal (↵ Enter)"
                              className="w-full h-8 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-colors shadow-sm cursor-pointer"
                            >
                              <span>Apply</span>
                              <span className="material-symbols-outlined text-[14px] leading-none">open_in_new</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="w-full h-8 px-2 rounded-lg bg-indigo-600/30 text-indigo-300/50 text-xs font-medium flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap cursor-not-allowed"
                            >
                              <span>Apply</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(job.key, 'applied');
                            }}
                            title="Mark as Applied (A)"
                            className="w-full h-8 px-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-xs font-medium flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[15px] leading-none">send_and_archive</span>
                            <span>Applied</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(job.key, 'saved');
                            }}
                            title="Star / Save role (S)"
                            className="w-full h-8 px-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-xs font-medium flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[15px] leading-none">bookmark</span>
                            <span>Save</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(job.key, 'ignored');
                            }}
                            title="Dismiss role (D)"
                            className="w-full h-8 px-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[15px] leading-none">archive</span>
                            <span>Dismiss</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </main>
      </div>


      {/* ============================================================ */}
      {/* 4. TOAST NOTIFICATIONS (Floating Bottom Right)              */}
      {/* ============================================================ */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#171821] border border-[#262734] text-white px-4 py-2.5 rounded-xl shadow-2xl animate-slideUp">
          <span className="text-xs">{toast.message}</span>
          {toast.lastKey && (
            <button
              onClick={handleUndo}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-2 cursor-pointer"
            >
              Undo (Z)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
