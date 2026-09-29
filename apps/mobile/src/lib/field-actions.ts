import { isNetworkError, post } from './api';
import {
  enqueue,
  getQueueForUser,
  QueuedAction,
  REF_PLACEHOLDER,
  syncQueue,
} from './offline-queue';
import type { TimeEntry } from './types';

export type Outcome<T> = { status: 'sent'; data: T } | { status: 'queued'; action: QueuedAction };

type Draft = Omit<QueuedAction, 'id' | 'timestamp' | 'userId' | 'method'>;

/**
 * Sends a field action now, or queues it when there is no network.
 * HTTP errors (4xx business rules, validation, 5xx) are thrown to the caller
 * and never queued. Earlier queued actions are flushed first so the server
 * sees clock-in/out in the order the user did them.
 */
async function sendOrQueue<T>(userId: string, draft: Draft): Promise<Outcome<T>> {
  const action = { ...draft, userId, method: 'POST' as const };

  // Depends on a clock-in the server hasn't seen yet: can only be queued.
  if (draft.dependsOn) return { status: 'queued', action: await enqueue(action) };

  if ((await getQueueForUser(userId)).length > 0) {
    const { remaining } = await syncQueue(userId);
    if (remaining > 0) return { status: 'queued', action: await enqueue(action) };
  }

  try {
    const data = await post<T>(draft.endpoint, draft.body);
    return { status: 'sent', data };
  } catch (err) {
    if (isNetworkError(err)) return { status: 'queued', action: await enqueue(action) };
    throw err;
  }
}

export function clockIn(userId: string, projectId: string, projectName: string) {
  return sendOrQueue<TimeEntry>(userId, {
    kind: 'clock-in',
    endpoint: '/timekeeping/clock-in',
    // The tap time, so a clock-in replayed from the offline queue keeps its real time.
    body: { projectId, occurredAt: new Date().toISOString() },
    label: projectName,
  });
}

/** `target` is either a server entry id or a still-queued clock-in. */
export function clockOut(userId: string, target: { entryId: string } | { queuedClockInId: string }) {
  if ('entryId' in target) {
    return sendOrQueue<TimeEntry>(userId, {
      kind: 'clock-out',
      endpoint: `/timekeeping/clock-out/${target.entryId}`,
      body: { occurredAt: new Date().toISOString() },
    });
  }
  return sendOrQueue<TimeEntry>(userId, {
    kind: 'clock-out',
    endpoint: `/timekeeping/clock-out/${REF_PLACEHOLDER}`,
    body: { occurredAt: new Date().toISOString() },
    dependsOn: target.queuedClockInId,
  });
}

export interface DailyReportInput {
  projectId: string;
  date: string; // YYYY-MM-DD
  workDescription?: string;
  weather?: string;
  notes?: string;
}

export function createDailyReport(userId: string, input: DailyReportInput, projectName: string) {
  // Only send fields that have a value (the DTO rejects unknown fields; empty strings are noise).
  const body: Record<string, string> = { projectId: input.projectId, date: input.date };
  if (input.workDescription?.trim()) body.workDescription = input.workDescription.trim();
  if (input.weather?.trim()) body.weather = input.weather.trim();
  if (input.notes?.trim()) body.notes = input.notes.trim();

  return sendOrQueue<{ id: string }>(userId, {
    kind: 'daily-report',
    endpoint: '/daily-reports',
    body,
    label: projectName,
  });
}

export function submitEntries(entryIds: string[]) {
  return post<unknown>('/timekeeping/submit', { entryIds });
}

/** Local calendar date as YYYY-MM-DD. */
export function todayISO(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
