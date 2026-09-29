import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

const PRIMARY = '#2563eb';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <Text style={styles.title}>OXACAN Mobile</Text>
        <Text style={styles.subtitle}>Swiss Construction ERP</Text>

        {/* Clock status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Clock Status</Text>
          <Text style={styles.statusValue}>Not clocked in</Text>
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionHeader}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton}>
            <Text style={styles.actionIcon}>I</Text>
            <Text style={styles.actionText}>Clock In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Text style={styles.actionIcon}>R</Text>
            <Text style={styles.actionText}>New Report</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Text style={styles.actionIcon}>E</Text>
            <Text style={styles.actionText}>New Expense</Text>
          </TouchableOpacity>
        </View>

        {/* Today's summary */}
        <Text style={styles.sectionHeader}>Today's Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Hours worked</Text>
            <Text style={styles.summaryValue}>--:--</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tasks completed</Text>
            <Text style={styles.summaryValue}>0 / 0</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Pending reports</Text>
            <Text style={styles.summaryValue}>0</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY, marginTop: 12 },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24 },

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
