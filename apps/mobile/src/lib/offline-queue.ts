import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError, errorMessage } from './api';
import { t } from '../i18n';

/**
 * Offline queue for field actions (clock-in, clock-out, daily report).
 *
 * Only requests that failed without an HTTP response (network down, timeout)
 * are queued — see `withOfflineFallback`. Requests are stored without any
 * token; `api()` reads the current Supabase session when they are replayed.
 *
 * Every action carries an idempotency key (UUID) that is persisted with it and
 * sent as the Idempotency-Key header on every attempt, including the first,
 * online one (see field-actions.ts). If a request timed out after the server
 * processed it, the replay gets the stored response back instead of creating
 * a duplicate (Build Strategy §10.4 / §12.2).
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
  /** Sent as Idempotency-Key on every attempt; never changes once assigned. */
  idempotencyKey: string;
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
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
/** The server is still processing an earlier attempt with the same key. */
const KEY_IN_PROGRESS = 'IDEMPOTENCY_KEY_IN_PROGRESS';

/**
 * RFC 4122 v4 UUID. Hermes has no crypto.randomUUID/getRandomValues without a
 * polyfill, so Math.random is the fallback: keys only need to be unique per
 * user within the server's 48 h retention window.
 */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

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
  let queue: QueuedAction[];
  try {
    const parsed = JSON.parse(raw);
    queue = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
  // Items queued by an older app version have no key: assign one and persist it
  // right away, so every later replay of the item sends the same key.
  const missing = queue.filter((a) => !a.idempotencyKey);
  if (missing.length > 0) {
    for (const a of missing) a.idempotencyKey = newIdempotencyKey();
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
  return queue;
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
/**
 * Pass the key already used for a failed online attempt, so the replay is
 * recognised by the server; a new key is generated otherwise.
 */
export function enqueue(
  action: Omit<QueuedAction, 'id' | 'timestamp' | 'idempotencyKey'> & { idempotencyKey?: string },
): Promise<QueuedAction> {
  return serial(async () => {
    const queue = await read();
    const item: QueuedAction = {
      ...action,
      id: `${Date.now()}-${++seq}`,
      timestamp: Date.now(),
      idempotencyKey: action.idempotencyKey ?? newIdempotencyKey(),
    };
    queue.push(item);
    await write(queue);
    return item;
  });
}

/**
 * Replays the current user's queued actions in order. Actions of other users
 * (someone signed out with pending items) are left untouched.
 *  - success            → removed; dependants get the real entry id (a replay of
 *                         an already-processed key returns the stored response)
 *  - 409 key in progress → stop; an earlier attempt is still running server-side
 *  - other 409          → removed as synced: the server already has it (§12.2)
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
        headers: { [IDEMPOTENCY_HEADER]: next.idempotencyKey },
      });
      await removeAction(next.id, next.kind === 'clock-in' ? result?.id : undefined);
      synced++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === KEY_IN_PROGRESS) break; // first attempt still running: retry later
        // Already on the server. A clock-in gives no entry id here, so its
        // dependants are reported as orphans on the next pass.
        await removeAction(next.id);
        synced++;
        continue;
      }
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
