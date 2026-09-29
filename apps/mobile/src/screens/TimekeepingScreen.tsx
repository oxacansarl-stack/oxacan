import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useField } from '../state/FieldContext';
import { dayLabel, elapsed, hhmm, hours, shortTime } from '../lib/format';
import type { TimeEntry } from '../lib/types';
import { statusLabel, t } from '../i18n';

const PRIMARY = '#2563eb';

const STATUS_COLORS: Record<string, string> = {
  draft: '#64748b',
  submitted: '#1e40af',
  approved: '#166534',
  rejected: '#b91c1c',
};

export default function TimekeepingScreen() {
  const { clock, projects, entries, queue, loadError, refresh, clockIn, clockOut, submitDrafts } = useField();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(new Date());

  const clockedIn = clock.state === 'in';

  // Default the picker to the last project worked on.
  useEffect(() => {
    if (!selectedProject || !projects.some((p) => p.id === selectedProject)) {
      const last = entries[0]?.projectId;
      setSelectedProject(projects.some((p) => p.id === last) ? last! : projects[0]?.id ?? null);
    }
  }, [projects, entries, selectedProject]);

  useEffect(() => {
    if (!clockedIn) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [clockedIn]);

  const drafts = entries.filter((e) => e.status === 'draft' && e.endTime);
  const pendingReports = queue.filter((a) => a.kind === 'daily-report').length;

  async function onClockPress() {
    if (busy) return;
    setBusy(true);
    if (clockedIn) await clockOut();
    else if (selectedProject) await clockIn(selectedProject);
    setBusy(false);
  }

  async function onSubmit() {
    setBusy(true);
    await submitDrafts();
    setBusy(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const header = (
    <View>
      <Text style={styles.title}>{t('time.title')}</Text>

      {loadError ? <Text style={styles.warning}>{t('state.offlineStale')}</Text> : null}

      {/* Timer display */}
      <View style={styles.timerCard}>
        <Text style={styles.timerLabel}>
          {clock.state === 'in'
            ? t('time.clockedInSince', { time: hhmm(clock.since), project: clock.projectName })
            : t('home.notClockedIn')}
        </Text>
        <Text style={styles.timerValue}>{clock.state === 'in' ? elapsed(clock.since, now) : '00:00:00'}</Text>
        {clock.pending ? <Text style={styles.pending}>{t('state.waitingToSync')}</Text> : null}
      </View>

      {/* Clock in/out button */}
      <TouchableOpacity
        style={[
          styles.clockButton,
          clockedIn && styles.clockButtonOut,
          (busy || (!clockedIn && !selectedProject)) && styles.disabled,
        ]}
        onPress={onClockPress}
        disabled={busy || (!clockedIn && !selectedProject)}
        activeOpacity={0.8}
      >
        <Text style={styles.clockButtonText}>{clockedIn ? t('clock.out') : t('clock.in')}</Text>
      </TouchableOpacity>

      {/* Project selector (only relevant before clocking in) */}
      {!clockedIn ? (
        <>
          <Text style={styles.sectionHeader}>{t('time.project')}</Text>
          <View style={styles.projectRow}>
            {projects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.projectChip, selectedProject === p.id && styles.projectChipActive]}
                onPress={() => setSelectedProject(p.id)}
              >
                <Text style={[styles.projectChipText, selectedProject === p.id && styles.projectChipTextActive]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
            {projects.length === 0 ? <Text style={styles.muted}>{t('time.noProjects')}</Text> : null}
          </View>
        </>
      ) : null}

      {/* Recent entries */}
      <View style={styles.entriesHeader}>
        <Text style={styles.sectionHeader}>{t('time.recentEntries')}</Text>
        {drafts.length > 0 ? (
          <TouchableOpacity onPress={onSubmit} disabled={busy}>
            <Text style={styles.submitLink}>{t('time.submitDrafts', { count: drafts.length })}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {pendingReports > 0 ? (
        <Text style={styles.muted}>
          {t('time.pendingReports', { count: pendingReports })}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        style={styles.container}
        data={entries}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.muted}>{t('time.noEntries')}</Text>}
        renderItem={({ item }) => <EntryRow entry={item} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function EntryRow({ entry }: { entry: TimeEntry }) {
  const statusColor = STATUS_COLORS[entry.status] ?? '#64748b';
  return (
    <View style={styles.entryRow}>
      <View>
        <Text style={styles.entryDate}>{dayLabel(String(entry.date))}</Text>
        <Text style={styles.entryTime}>
          {shortTime(entry.startTime)} – {shortTime(entry.endTime)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', flexShrink: 1, marginLeft: 12 }}>
        <Text style={styles.entryHours}>{entry.totalMinutes == null ? t('state.notAvailable') : hours(entry.totalMinutes)}</Text>
        <Text style={styles.entryProject} numberOfLines={1}>
          {entry.project?.name ?? ''}
        </Text>
        <Text style={[styles.entryStatus, { color: statusColor }]}>{statusLabel('timeEntry', entry.status)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY, marginTop: 12, marginBottom: 20 },
  warning: { fontSize: 13, color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 8, padding: 10, marginBottom: 16 },
  muted: { fontSize: 13, color: '#94a3b8', marginBottom: 10 },

  timerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timerLabel: { fontSize: 14, color: '#94a3b8', marginBottom: 8, textAlign: 'center' },
  timerValue: { fontSize: 40, fontWeight: '700', color: '#1e293b', fontVariant: ['tabular-nums'] },
  pending: { fontSize: 12, fontWeight: '600', color: '#92400e', marginTop: 8 },

  clockButton: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 24,
  },
  clockButtonOut: { backgroundColor: '#dc2626' },
  clockButtonText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  disabled: { opacity: 0.6 },

  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 10,
  },
  entriesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  submitLink: { fontSize: 14, fontWeight: '600', color: PRIMARY },

  projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  projectChip: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f1f5f9',
  },
  projectChipActive: { backgroundColor: PRIMARY },
  projectChipText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  projectChipTextActive: { color: '#fff' },

  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  entryDate: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  entryTime: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  entryHours: { fontSize: 15, fontWeight: '700', color: PRIMARY },
  entryProject: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  entryStatus: { fontSize: 11, fontWeight: '600', marginTop: 2 },
});
