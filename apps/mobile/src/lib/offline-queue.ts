import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError, errorMessage } from './api';
import { t } from '../i18n';

/**
 * Offline queue for field actions (clock-in, clock-out, daily report).
 *
 * Only requests that failed without an HTTP response (network down, timeout)
 * are queued — see `withOfflineFallback`. Requests are stored without any
 * token; `api()` reads the current Supabase session when they are replayed.
 */

export type QueuedKind = 'clock-in' | 'clock-out' | 'daily-report';

export interface QueuedAction {
  id: string;
  userId: string;
  kind: QueuedKind;
  endpoint: string;
  method: 'POST';
  body?: unknown;
  timestamp: number;
  /**
   * Local id of a queued clock-in whose server id is still unknown. The
   * endpoint then contains REF_PLACEHOLDER, replaced once that clock-in syncs.
   */
  dependsOn?: string;
  /** For display while pending (e.g. project name). */
  label?: string;
}

export interface SyncFailure {
  action: QueuedAction;
  message: string;
}

export interface SyncResult {
  synced: number;
  failed: SyncFailure[];
  remaining: number;
}

export const REF_PLACEHOLDER = ':pendingEntryId';
const QUEUE_KEY = 'oxacan_offline_queue';

/* ── Storage (serialised so interleaved async writes can't lose items) ── */

let lock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function read(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function write(queue: QueuedAction[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  listeners.forEach((l) => l(queue));
}

/* ── Change listeners (UI shows pending actions) ─────────── */

type Listener = (queue: QueuedAction[]) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Receives actions dropped during replay (HTTP 4xx) so the UI can tell the user. */
type FailureReporter = (failures: SyncFailure[]) => void;
let reportFailures: FailureReporter | null = null;
export function setFailureReporter(fn: FailureReporter | null): void {
  reportFailures = fn;
}

/* ── Public API ──────────────────────────────────────────── */

export function getQueue(): Promise<QueuedAction[]> {
  return serial(read);
}

export async function getQueueForUser(userId: string): Promise<QueuedAction[]> {
  return (await getQueue()).filter((a) => a.userId === userId);
}

let seq = 0;
export function enqueue(action: Omit<QueuedAction, 'id' | 'timestamp'>): Promise<QueuedAction> {
  return serial(async () => {
    const queue = await read();
    const item: QueuedAction = {
      ...action,
      id: `${Date.now()}-${++seq}`,
      timestamp: Date.now(),
    };
    queue.push(item);
    await write(queue);
    return item;
  });
}

/**
 * Replays the current user's queued actions in order. Actions of other users
 * (someone signed out with pending items) are left untouched.
 *  - success            → removed; dependants get the real entry id
 *  - HTTP 4xx           → removed and reported (it will never succeed)
 *  - network/5xx/401    → stop; the rest stays queued for the next attempt
 */
let inFlight: Promise<SyncResult> | null = null;

export function syncQueue(userId: string): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = replay(userId).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function removeAction(id: string, resolvedEntryId?: string): Promise<void> {
  await serial(async () => {
    const queue = (await read()).filter((a) => a.id !== id);
    if (resolvedEntryId) {
      for (const a of queue) {
        if (a.dependsOn === id) {
          a.endpoint = a.endpoint.replace(REF_PLACEHOLDER, resolvedEntryId);
          delete a.dependsOn;
        }
      }
    }
    await write(queue);
  });
}

async function replay(userId: string): Promise<SyncResult> {
  const failed: SyncFailure[] = [];
  let synced = 0;

  for (;;) {
    const mine = (await getQueue()).filter((a) => a.userId === userId);
    // Next action whose dependency has been resolved.
    const next = mine.find((a) => !a.dependsOn);
    if (!next) {
      // Anything left depends on a clock-in that no longer exists: drop it.
      for (const orphan of mine) {
        failed.push({ action: orphan, message: t('offline.orphan') });
        await removeAction(orphan.id);
      }
      break;
    }

    try {
      const result = await api<{ id?: string }>(next.endpoint, {
        method: next.method,
        body: next.body === undefined ? undefined : JSON.stringify(next.body),
      });
      await removeAction(next.id, next.kind === 'clock-in' ? result?.id : undefined);
      synced++;
    } catch (err) {
      if (err instanceof ApiError && err.isClientError && err.status !== 401) {
        failed.push({ action: next, message: errorMessage(err) });
        await removeAction(next.id);
        continue;
      }
      break; // offline, server error or signed out: retry later
    }
  }

  if (failed.length > 0 && reportFailures) reportFailures(failed);
  const remaining = (await getQueue()).filter((a) => a.userId === userId).length;
  return { synced, failed, remaining };
}
