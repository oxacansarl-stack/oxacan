import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useProfile } from '../auth/AuthContext';
import { useField } from '../state/FieldContext';
import { apiList, errorMessage, patch } from '../lib/api';
import type { Task, TaskStatus } from '../lib/types';
import { statusLabel, t } from '../i18n';

const PRIMARY = '#2563eb';

interface TaskRow extends Task {
  projectName: string;
}

const STATUS_COLORS: Record<TaskStatus, { bg: string; text: string }> = {
  todo:        { bg: '#fef3c7', text: '#92400e' },
  in_progress: { bg: '#dbeafe', text: '#1e40af' },
  done:        { bg: '#dcfce7', text: '#166534' },
  validated:   { bg: '#dcfce7', text: '#166534' },
  cancelled:   { bg: '#f1f5f9', text: '#64748b' },
};

/** Statuses a field user can set from the app (the API limits workers to these). */
const EDITABLE_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];
const PROGRESS_STEPS = [0, 25, 50, 75, 100];

function TaskItem({
  task,
  expanded,
  saving,
  onToggle,
  onUpdate,
}: {
  task: TaskRow;
  expanded: boolean;
  saving: boolean;
  onToggle: () => void;
  onUpdate: (changes: { status?: TaskStatus; progressPercent?: number }) => void;
}) {
  const badge = STATUS_COLORS[task.status] ?? STATUS_COLORS.todo;
  const locked = task.status === 'validated' || task.status === 'cancelled';
  return (
    <TouchableOpacity style={styles.taskCard} activeOpacity={0.7} onPress={onToggle}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>{statusLabel('task', task.status)}</Text>
        </View>
      </View>
      <Text style={styles.taskProject}>
        {task.projectName} · {task.progressPercent} %
      </Text>

      {expanded && !locked ? (
        <View style={styles.editor}>
          <Text style={styles.editorLabel}>{t('tasks.status')}</Text>
          <View style={styles.chipRow}>
            {EDITABLE_STATUSES.map((s) => (
              <TouchableOpacity
                key={s}
                disabled={saving || s === task.status}
                style={[styles.chip, s === task.status && styles.chipActive]}
                onPress={() => onUpdate({ status: s, ...(s === 'done' ? { progressPercent: 100 } : {}) })}
              >
                <Text style={[styles.chipText, s === task.status && styles.chipTextActive]}>
                  {statusLabel('task', s)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.editorLabel}>{t('tasks.progress')}</Text>
          <View style={styles.chipRow}>
            {PROGRESS_STEPS.map((p) => (
              <TouchableOpacity
                key={p}
                disabled={saving || p === task.progressPercent}
                style={[styles.chip, p === task.progressPercent && styles.chipActive]}
                onPress={() => onUpdate({ progressPercent: p })}
              >
                <Text style={[styles.chipText, p === task.progressPercent && styles.chipTextActive]}>{p} %</Text>
              </TouchableOpacity>
            ))}
          </View>
          {saving ? <ActivityIndicator color={PRIMARY} style={{ marginTop: 8 }} /> : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function TasksScreen() {
  const profile = useProfile();
  const { projects } = useField();
  const isWorker = profile.role === 'WORKER';

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // No "my tasks" endpoint exists, so tasks are fetched per visible project.
  const load = useCallback(async () => {
    if (projects.length === 0) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const assigned = isWorker ? `&assignedTo=${profile.id}` : '';
      const lists = await Promise.all(
        projects.map(async (p) => {
          const { items } = await apiList<Task>(`/projects/${p.id}/tasks?limit=200${assigned}`);
          return items.map((t) => ({ ...t, projectName: p.name }));
        }),
      );
      let all = lists.flat();
      if (isWorker) all = all.filter((t) => t.assignedTo === profile.id);
      const order: Record<string, number> = { in_progress: 0, todo: 1, done: 2, validated: 3, cancelled: 4 };
      all.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      setTasks(all);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projects, isWorker, profile.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(task: TaskRow, changes: { status?: TaskStatus; progressPercent?: number }) {
    setSavingId(task.id);
    try {
      const updated = await patch<Task>(`/projects/${task.projectId}/tasks/${task.id}`, changes);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: updated.status ?? t.status, progressPercent: updated.progressPercent ?? t.progressPercent }
            : t,
        ),
      );
    } catch (err) {
      Alert.alert(t('tasks.updateFailed'), errorMessage(err));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('tasks.title')}</Text>
        <Text style={styles.subtitle}>
          {loading
            ? t('state.loading')
            : t(isWorker ? 'tasks.assignedCount' : 'tasks.count', { count: tasks.length })}
        </Text>
        {error ? <Text style={styles.warning}>{error}</Text> : null}

        <FlatList
          data={tasks}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => (
            <TaskItem
              task={item}
              expanded={expandedId === item.id}
              saving={savingId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onUpdate={(changes) => update(item, changes)}
            />
          )}
          ListEmptyComponent={!loading ? <Text style={styles.taskProject}>{t('tasks.empty')}</Text> : null}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY, marginTop: 12 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 20 },
  warning: { fontSize: 13, color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 8, padding: 10, marginBottom: 16 },

  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskTitle: { fontSize: 15, fontWeight: '600', color: '#1e293b', flex: 1, marginRight: 8 },
  taskProject: { fontSize: 13, color: '#94a3b8' },

  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  editor: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12 },
  editorLabel: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: PRIMARY },
  chipText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  chipTextActive: { color: '#fff' },
});
