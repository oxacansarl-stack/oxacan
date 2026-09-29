import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useField } from '../state/FieldContext';
import { todayISO } from '../lib/field-actions';
import { formatDate } from '../lib/format';
import { t } from '../i18n';

const PRIMARY = '#2563eb';

interface Props {
  visible: boolean;
  defaultProjectId: string | null;
  onClose: () => void;
}

export default function DailyReportModal({ visible, defaultProjectId, onClose }: Props) {
  const { projects, createDailyReport } = useField();
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId);
  const [workDescription, setWorkDescription] = useState('');
  const [weather, setWeather] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset only when the modal opens, so a background refresh never wipes typed text.
  useEffect(() => {
    if (visible) {
      setProjectId(defaultProjectId ?? projects[0]?.id ?? null);
      setWorkDescription('');
      setWeather('');
      setNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canSubmit = !!projectId && workDescription.trim().length > 0 && !busy;

  async function onSubmit() {
    if (!canSubmit || !projectId) return;
    setBusy(true);
    const ok = await createDailyReport({ projectId, date: todayISO(), workDescription, weather, notes });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <Text style={styles.title}>{t('report.title')}</Text>
            <TouchableOpacity onPress={onClose} disabled={busy}>
              <Text style={styles.cancel}>{t('actions.cancel')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>{formatDate(todayISO())}</Text>

          <Text style={styles.sectionHeader}>{t('report.project')}</Text>
          <View style={styles.projectRow}>
            {projects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.projectChip, projectId === p.id && styles.projectChipActive]}
                onPress={() => setProjectId(p.id)}
              >
                <Text style={[styles.projectChipText, projectId === p.id && styles.projectChipTextActive]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
            {projects.length === 0 ? <Text style={styles.muted}>{t('report.noProjects')}</Text> : null}
          </View>

          <Text style={styles.sectionHeader}>{t('report.workDone')}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={workDescription}
            onChangeText={setWorkDescription}
            multiline
            placeholder={t('report.workDonePlaceholder')}
            placeholderTextColor="#94a3b8"
          />

          <Text style={styles.sectionHeader}>{t('report.weather')}</Text>
          <TextInput
            style={styles.input}
            value={weather}
            onChangeText={setWeather}
            placeholder={t('report.weatherPlaceholder')}
            placeholderTextColor="#94a3b8"
          />

          <Text style={styles.sectionHeader}>{t('report.notes')}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder={t('report.optional')}
            placeholderTextColor="#94a3b8"
          />

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('report.send')}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { padding: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY },
  cancel: { fontSize: 16, color: '#64748b' },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 20 },
  sectionHeader: { fontSize: 16, fontWeight: '600', color: '#334155', marginBottom: 10 },
  muted: { fontSize: 13, color: '#94a3b8' },

  projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  projectChip: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#f1f5f9' },
  projectChipActive: { backgroundColor: PRIMARY },
  projectChipText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  projectChipTextActive: { color: '#fff' },

  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1e293b',
    backgroundColor: '#fff',
    marginBottom: 20,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },

  button: { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 24 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
