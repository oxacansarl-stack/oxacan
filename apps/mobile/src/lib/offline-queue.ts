import AsyncStorage from '@react-native-async-storage/async-storage';

interface QueuedAction {
  id: string;
  endpoint: string;
  method: string;
  body: unknown;
  timestamp: number;
}

const QUEUE_KEY = 'oxacan_offline_queue';

export async function enqueue(
  action: Omit<QueuedAction, 'id' | 'timestamp'>,
): Promise<void> {
  const queue = await getQueue();
  queue.push({
    ...action,
    id: Date.now().toString(),
    timestamp: Date.now(),
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([]));
}

export async function syncQueue(
  apiFn: (path: string, opts: RequestInit) => Promise<unknown>,
): Promise<{ synced: number; failed: number }> {
  const queue = await getQueue();
  let synced = 0;
  let failed = 0;

  for (const action of queue) {
    try {
      await apiFn(action.endpoint, {
        method: action.method,
        body: JSON.stringify(action.body),
      });
      synced++;
    } catch {
      failed++;
    }
  }

  if (failed === 0) {
    await clearQueue();
  }

  return { synced, failed };
}
