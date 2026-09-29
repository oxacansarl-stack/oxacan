import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

const PRIMARY = '#2563eb';

interface TimeEntry {
  id: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  project: string;
  hours: string;
}

const SAMPLE_ENTRIES: TimeEntry[] = [
  { id: '1', date: 'Today', clockIn: '07:15', clockOut: null, project: 'Residence Lac', hours: '--' },
  { id: '2', date: 'Yesterday', clockIn: '07:00', clockOut: '16:30', project: 'Residence Lac', hours: '8.5h' },
  { id: '3', date: '2 days ago', clockIn: '06:45', clockOut: '16:15', project: 'Pont A1 Morges', hours: '8.5h' },
];

const PROJECTS = ['Residence Lac', 'Pont A1 Morges', 'Immeuble Vevey'];

export default function TimekeepingScreen() {
  const [clockedIn, setClockedIn] = useState(false);
  const [selectedProject, setSelectedProject] = useState(PROJECTS[0]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Timekeeping</Text>

        {/* Timer display */}
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>
            {clockedIn ? 'Clocked in since 07:15' : 'Not clocked in'}
          </Text>
          <Text style={styles.timerValue}>{clockedIn ? '03:27:14' : '00:00:00'}</Text>
        </View>

        {/* Clock in/out button */}
        <TouchableOpacity
          style={[styles.clockButton, clockedIn && styles.clockButtonOut]}
          onPress={() => setClockedIn(!clockedIn)}
          activeOpacity={0.8}
        >
          <Text style={styles.clockButtonText}>
            {clockedIn ? 'Clock Out' : 'Clock In'}
          </Text>
        </TouchableOpacity>

        {/* Project selector */}
        <Text style={styles.sectionHeader}>Project</Text>
        <View style={styles.projectRow}>
          {PROJECTS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.projectChip,
                selectedProject === p && styles.projectChipActive,
              ]}
              onPress={() => setSelectedProject(p)}
            >
              <Text
                style={[
                  styles.projectChipText,
                  selectedProject === p && styles.projectChipTextActive,
                ]}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recent entries */}
        <Text style={styles.sectionHeader}>Recent Entries</Text>
        <FlatList
          data={SAMPLE_ENTRIES}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <View style={styles.entryRow}>
              <View>
                <Text style={styles.entryDate}>{item.date}</Text>
                <Text style={styles.entryTime}>
                  {item.clockIn} - {item.clockOut ?? '...'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.entryHours}>{item.hours}</Text>
                <Text style={styles.entryProject}>{item.project}</Text>
              </View>
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY, marginTop: 12, marginBottom: 20 },

  timerCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timerLabel: { fontSize: 14, color: '#94a3b8', marginBottom: 8 },
  timerValue: { fontSize: 40, fontWeight: '700', color: '#1e293b', fontVariant: ['tabular-nums'] },

  clockButton: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 24,
  },
  clockButtonOut: { backgroundColor: '#dc2626' },
  clockButtonText: { fontSize: 18, fontWeight: '700', color: '#fff' },

  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 10,
  },

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
});
