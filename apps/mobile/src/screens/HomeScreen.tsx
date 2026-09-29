import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useProfile } from '../auth/AuthContext';
import { useField } from '../state/FieldContext';
import DailyReportModal from '../components/DailyReportModal';
import { todayISO } from '../lib/field-actions';
import { hhmm, hours } from '../lib/format';

const PRIMARY = '#2563eb';

export default function HomeScreen() {
  const profile = useProfile();
  const navigation = useNavigation<any>();
  const { clock, entries, weekly, queue, projects, loading, loadError, refresh, clockIn, clockOut } = useField();
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  // Re-render every minute so "hours today" includes the running entry.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Quick clock-in uses the last project worked on; otherwise open the Time tab to pick one.
  const lastProjectId = entries[0]?.projectId ?? null;
  const quickProjectId = lastProjectId && projects.some((p) => p.id === lastProjectId) ? lastProjectId : null;

  const today = todayISO();
  const todayMinutes =
    entries
      .filter((e) => String(e.date).slice(0, 10) === today && e.endTime)
      .reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0) +
    (clock.state === 'in' && todayISO(clock.since) === today
      ? (Date.now() - clock.since.getTime()) / 60000
      : 0);
  const weekMinutes = weekly ? weekly.totalNormal + weekly.totalOvertime + weekly.totalTravel : null;

  async function onClockPress() {
    if (busy) return;
    if (clock.state === 'out' && !quickProjectId) {
      navigation.navigate('Time');
      return;
    }
    setBusy(true);
    if (clock.state === 'in') await clockOut();
    else if (quickProjectId) await clockIn(quickProjectId);
    setBusy(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  const reportProjectId = clock.state === 'in' ? clock.projectId : quickProjectId;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Text style={styles.title}>OXACAN Mobile</Text>
        <Text style={styles.subtitle}>Hello, {profile.firstName}</Text>

        {loadError ? <Text style={styles.warning}>Offline — showing last known data. {loadError}</Text> : null}

        {/* Clock status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Clock Status</Text>
          <Text style={styles.statusValue}>
            {loading && entries.length === 0
              ? 'Loading...'
              : clock.state === 'in'
                ? `Clocked in since ${hhmm(clock.since)}`
                : 'Not clocked in'}
          </Text>
          {clock.state === 'in' ? <Text style={styles.statusDetail}>{clock.projectName}</Text> : null}
          {clock.pending ? <Text style={styles.pending}>Waiting to sync</Text> : null}
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionHeader}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, clock.state === 'in' && styles.actionButtonOut, busy && styles.disabled]}
            onPress={onClockPress}
            disabled={busy}
          >
            <Text style={styles.actionIcon}>{clock.state === 'in' ? 'O' : 'I'}</Text>
            <Text style={styles.actionText}>{clock.state === 'in' ? 'Clock Out' : 'Clock In'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => setReportOpen(true)}>
            <Text style={styles.actionIcon}>R</Text>
            <Text style={styles.actionText}>New Report</Text>
          </TouchableOpacity>
        </View>

        {/* Summary */}
        <Text style={styles.sectionHeader}>Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Hours today</Text>
            <Text style={styles.summaryValue}>{hours(todayMinutes)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Hours this week</Text>
            <Text style={styles.summaryValue}>{weekMinutes === null ? '--' : hours(weekMinutes)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Waiting to sync</Text>
            <Text style={styles.summaryValue}>{queue.length}</Text>
          </View>
        </View>
      </ScrollView>

      <DailyReportModal
        visible={reportOpen}
        defaultProjectId={reportProjectId}
        onClose={() => setReportOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { padding: 20 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY, marginTop: 12 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24 },
  warning: { fontSize: 13, color: '#92400e', backgroundColor: '#fef3c7', borderRadius: 8, padding: 10, marginBottom: 16 },

  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statusLabel: { fontSize: 13, color: '#94a3b8', marginBottom: 4 },
  statusValue: { fontSize: 18, fontWeight: '600', color: '#334155' },
  statusDetail: { fontSize: 14, color: '#64748b', marginTop: 2 },
  pending: { fontSize: 12, fontWeight: '600', color: '#92400e', marginTop: 6 },

  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 12,
  },
  actionsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  actionButton: {
    flex: 1,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  actionButtonOut: { backgroundColor: '#dc2626' },
  disabled: { opacity: 0.6 },
  actionIcon: { fontSize: 20, color: '#fff', marginBottom: 4 },
  actionText: { fontSize: 12, fontWeight: '600', color: '#fff' },

  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  summaryLabel: { fontSize: 14, color: '#64748b' },
  summaryValue: { fontSize: 14, fontWeight: '600', color: '#334155' },
});
