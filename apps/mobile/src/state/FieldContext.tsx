import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useProfile } from '../auth/AuthContext';
import { api, apiList, errorMessage, isNetworkError } from '../lib/api';
import {
  getQueueForUser,
  QueuedAction,
  setFailureReporter,
  subscribe,
  syncQueue,
} from '../lib/offline-queue';
import * as actions from '../lib/field-actions';
import type { Project, TimeEntry, WeeklySummary } from '../lib/types';

/** What the clock widget shows, combining server entries and queued actions. */
export type ClockState =
  | { state: 'out'; pending: boolean }
  | {
      state: 'in';
      since: Date;
      projectId: string | null;
      projectName: string;
      /** true while the clock-in itself is still only in the offline queue */
      pending: boolean;
      target: { entryId: string } | { queuedClockInId: string };
    };

interface FieldContextValue {
  projects: Project[];
  entries: TimeEntry[];
  weekly: WeeklySummary | null;
  queue: QueuedAction[];
  clock: ClockState;
  loading: boolean;
  /** Set when the last refresh failed (e.g. offline); data shown may be stale. */
  loadError: string | null;
  refresh: () => Promise<void>;
  clockIn: (projectId: string) => Promise<void>;
  clockOut: () => Promise<void>;
  submitDrafts: () => Promise<void>;
  createDailyReport: (input: actions.DailyReportInput) => Promise<boolean>;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** entry.date is 'YYYY-MM-DD' (or an ISO string), startTime 'HH:MM[:SS]', both Swiss local time. */
export function entryStart(entry: TimeEntry): Date {
  const [y, m, d] = String(entry.date).slice(0, 10).split('-').map(Number);
  const [hh, mm, ss] = entry.startTime.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss || 0);
}

function deriveClock(entries: TimeEntry[], queue: QueuedAction[], projects: Project[]): ClockState {
  const pendingIn = queue.filter((a) => a.kind === 'clock-in');
  const pendingOut = queue.filter((a) => a.kind === 'clock-out');

  // Latest queued clock-in without a queued clock-out depending on it.
  const openQueued = [...pendingIn].reverse().find((a) => !pendingOut.some((o) => o.dependsOn === a.id));
  if (openQueued) {
    const body = openQueued.body as { projectId?: string } | undefined;
    return {
      state: 'in',
      since: new Date(openQueued.timestamp),
      projectId: body?.projectId ?? null,
      projectName: openQueued.label ?? projects.find((p) => p.id === body?.projectId)?.name ?? 'Project',
      pending: true,
      target: { queuedClockInId: openQueued.id },
    };
  }

  const open = entries.find((e) => !e.endTime);
  const closedOffline = open && pendingOut.some((o) => o.endpoint.endsWith(`/${open.id}`));
  if (open && !closedOffline) {
    return {
      state: 'in',
      since: entryStart(open),
      projectId: open.projectId,
      projectName: open.project?.name ?? projects.find((p) => p.id === open.projectId)?.name ?? 'Project',
      pending: false,
      target: { entryId: open.id },
    };
  }
  return { state: 'out', pending: pendingOut.length > 0 };
}

export function FieldProvider({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const userId = profile.id;

  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, e, w] = await Promise.all([
        apiList<Project>('/projects?limit=100'),
        // Team leaders can see their team's entries; this screen is about the caller's own.
        apiList<TimeEntry>(`/timekeeping?limit=20&userId=${userId}`),
        api<WeeklySummary>('/timekeeping/summary/weekly'),
      ]);
      setProjects(p.items);
      setEntries(e.items);
      setWeekly(w);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /* ── Offline replay (then reload): on start, on foreground, on reconnect ── */

  const syncing = useRef(false);
  const syncAndRefresh = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      if ((await getQueueForUser(userId)).length > 0) await syncQueue(userId);
      await refresh();
    } finally {
      syncing.current = false;
    }
  }, [userId, refresh]);

  useEffect(() => {
    setFailureReporter((failures) => {
      const lines = failures.map((f) => `• ${describe(f.action)}: ${f.message}`).join('\n');
      Alert.alert('Some offline actions were rejected', lines);
    });

    const unsubscribe = subscribe((q) => setQueue(q.filter((a) => a.userId === userId)));
    getQueueForUser(userId).then(setQueue).catch(() => undefined);

    void syncAndRefresh();

    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncAndRefresh();
    });
    let wasConnected: boolean | null = null;
    const netUnsub = NetInfo.addEventListener((state) => {
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      if (connected && wasConnected === false) void syncAndRefresh();
      wasConnected = connected;
    });

    return () => {
      setFailureReporter(null);
      unsubscribe();
      appSub.remove();
      netUnsub();
    };
  }, [userId, refresh, syncAndRefresh]);

  const clock = useMemo(() => deriveClock(entries, queue, projects), [entries, queue, projects]);

  /* ── Actions ── */

  const clockIn = useCallback(
    async (projectId: string) => {
      const name = projects.find((p) => p.id === projectId)?.name ?? 'Project';
      try {
        const res = await actions.clockIn(userId, projectId, name);
        if (res.status === 'queued') {
          Alert.alert('Saved offline', 'No connection. Your clock-in will be sent when you are back online.');
        } else {
          await refresh();
        }
      } catch (err) {
        Alert.alert('Clock-in failed', errorMessage(err));
      }
    },
    [userId, projects, refresh],
  );

  const clockOut = useCallback(async () => {
    if (clock.state !== 'in') return;
    try {
      const res = await actions.clockOut(userId, clock.target);
      if (res.status === 'queued') {
        Alert.alert('Saved offline', 'No connection. Your clock-out will be sent when you are back online.');
      } else {
        await refresh();
      }
    } catch (err) {
      Alert.alert('Clock-out failed', errorMessage(err));
    }
  }, [userId, clock, refresh]);

  const submitDrafts = useCallback(async () => {
    const ids = entries.filter((e) => e.status === 'draft' && e.endTime).map((e) => e.id);
    if (ids.length === 0) return;
    try {
      await actions.submitEntries(ids);
      await refresh();
    } catch (err) {
      Alert.alert('Submit failed', isNetworkError(err) ? 'No connection. Try again when you are online.' : errorMessage(err));
    }
  }, [entries, refresh]);

  const createDailyReport = useCallback(
    async (input: actions.DailyReportInput) => {
      const name = projects.find((p) => p.id === input.projectId)?.name ?? 'Project';
      try {
        const res = await actions.createDailyReport(userId, input, name);
        Alert.alert(
          res.status === 'queued' ? 'Saved offline' : 'Report sent',
          res.status === 'queued'
            ? 'No connection. The report will be sent when you are back online.'
            : 'Your daily report was saved.',
        );
        return true;
      } catch (err) {
        Alert.alert('Report not saved', errorMessage(err));
        return false;
      }
    },
    [userId, projects],
  );

  const value = useMemo<FieldContextValue>(
    () => ({
      projects,
      entries,
      weekly,
      queue,
      clock,
      loading,
      loadError,
      refresh,
      clockIn,
      clockOut,
      submitDrafts,
      createDailyReport,
    }),
    [projects, entries, weekly, queue, clock, loading, loadError, refresh, clockIn, clockOut, submitDrafts, createDailyReport],
  );

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}

function describe(a: QueuedAction): string {
  const when = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const what = a.kind === 'clock-in' ? 'Clock-in' : a.kind === 'clock-out' ? 'Clock-out' : 'Daily report';
  return `${what} (${when}${a.label ? `, ${a.label}` : ''})`;
}

export function useField(): FieldContextValue {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('useField must be used inside FieldProvider');
  return ctx;
}
