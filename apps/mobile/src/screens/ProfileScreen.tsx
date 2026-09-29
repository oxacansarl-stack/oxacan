import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

const PRIMARY = '#2563eb';

interface SettingsItem {
  label: string;
  value?: string;
}

const SETTINGS_ITEMS: SettingsItem[] = [
  { label: 'Notifications', value: 'On' },
  { label: 'Language', value: 'FR' },
  { label: 'Offline Mode', value: 'Auto' },
  { label: 'GPS Tracking', value: 'On' },
];

export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        {/* User info */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>ML</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>Marc Lefebvre</Text>
            <Text style={styles.userRole}>Team Leader</Text>
          </View>
        </View>

        {/* Settings */}
        <Text style={styles.sectionHeader}>Settings</Text>
        <View style={styles.settingsCard}>
          {SETTINGS_ITEMS.map((item, idx) => (
            <TouchableOpacity
              key={item.label}
              style={[
                styles.settingsRow,
                idx < SETTINGS_ITEMS.length - 1 && styles.settingsRowBorder,
              ]}
            >
              <Text style={styles.settingsLabel}>{item.label}</Text>
              <Text style={styles.settingsValue}>{item.value}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} activeOpacity={0.7}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        {/* Version */}
        <Text style={styles.version}>OXACAN Mobile v0.1.0</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', color: PRIMARY, marginTop: 12, marginBottom: 24 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  userInfo: {},
  userName: { fontSize: 18, fontWeight: '600', color: '#1e293b' },
  userRole: { fontSize: 14, color: '#64748b', marginTop: 2 },

  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 10,
  },

  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 24,
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  settingsLabel: { fontSize: 15, color: '#334155' },
  settingsValue: { fontSize: 15, color: '#94a3b8' },

  logoutButton: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#dc2626',
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#dc2626' },

  version: { textAlign: 'center', fontSize: 12, color: '#cbd5e1' },
});
