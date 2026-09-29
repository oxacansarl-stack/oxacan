import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useAuth, useProfile } from '../auth/AuthContext';
import { useField } from '../state/FieldContext';
import { api } from '../lib/api';
import { ROLE_LABELS, type Company } from '../lib/types';

const PRIMARY = '#2563eb';

export default function ProfileScreen() {
  const profile = useProfile();
  const { signOut } = useAuth();
  const { queue } = useField();
  const [company, setCompany] = useState<string | null>(null);

  useEffect(() => {
    api<Company>('/companies/me')
      .then((c) => setCompany(c.name))
      .catch(() => setCompany(null));
  }, []);

  const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  const rows = [
    { label: 'Email', value: profile.email },
    { label: 'Company', value: company ?? '--' },
  ];

  function onSignOut() {
    if (queue.length === 0) {
      void signOut();
      return;
    }
    Alert.alert(
      'Unsynced actions',
      `${queue.length} action${queue.length > 1 ? 's are' : ' is'} waiting to sync. They stay on this device and will be sent the next time you sign in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        {/* User info */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>
              {profile.firstName} {profile.lastName}
            </Text>
            <Text style={styles.userRole}>{ROLE_LABELS[profile.role] ?? profile.role}</Text>
          </View>
        </View>

        {/* Account */}
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.settingsCard}>
          {rows.map((item, idx) => (
            <View
              key={item.label}
              style={[styles.settingsRow, idx < rows.length - 1 && styles.settingsRowBorder]}
            >
              <Text style={styles.settingsLabel}>{item.label}</Text>
              <Text style={styles.settingsValue} numberOfLines={1}>
                {item.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} activeOpacity={0.7} onPress={onSignOut}>
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
  settingsValue: { fontSize: 15, color: '#94a3b8', flexShrink: 1, marginLeft: 12 },

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
