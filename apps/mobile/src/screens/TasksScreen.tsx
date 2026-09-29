import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

const PRIMARY = '#2563eb';

interface Task {
  id: string;
  title: string;
  project: string;
  status: 'pending' | 'in_progress' | 'done';
}

const SAMPLE_TASKS: Task[] = [
  { id: '1', title: 'Install formwork Level 3', project: 'Residence Lac', status: 'in_progress' },
  { id: '2', title: 'Concrete pour Zone B', project: 'Residence Lac', status: 'pending' },
  { id: '3', title: 'Steel reinforcement check', project: 'Pont A1 Morges', status: 'pending' },
  { id: '4', title: 'Facade cladding prep', project: 'Immeuble Vevey', status: 'done' },
  { id: '5', title: 'Waterproofing basement', project: 'Pont A1 Morges', status: 'pending' },
];

const STATUS_COLORS: Record<Task['status'], { bg: string; text: string; label: string }> = {
  pending:     { bg: '#fef3c7', text: '#92400e', label: 'Pending' },
  in_progress: { bg: '#dbeafe', text: '#1e40af', label: 'In Progress' },
  done:        { bg: '#dcfce7', text: '#166534', label: 'Done' },
};

function TaskItem({ task }: { task: Task }) {
  const badge = STATUS_COLORS[task.status];
  return (
    <TouchableOpacity style={styles.taskCard} activeOpacity={0.7}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.taskProject}>{task.project}</Text>
    </TouchableOpacity>
  );
}

export default function TasksScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.subtitle}>{SAMPLE_TASKS.length} assigned tasks</Text>

        <FlatList
          data={SAMPLE_TASKS}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <TaskItem task={item} />}
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
});
