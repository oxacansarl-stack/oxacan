import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, SafeAreaView, Text, TouchableOpacity, View } from 'react-native';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { FieldProvider } from './state/FieldContext';
import LoginScreen from './screens/LoginScreen';

import HomeScreen from './screens/HomeScreen';
import TasksScreen from './screens/TasksScreen';
import TimekeepingScreen from './screens/TimekeepingScreen';
import ProfileScreen from './screens/ProfileScreen';
import { t } from './i18n';

/* ── Navigation type definitions ─────────────────────────── */

export type HomeStackParams = {
  HomeMain: undefined;
};

export type TasksStackParams = {
  TasksMain: undefined;
};

export type TimeStackParams = {
  TimeMain: undefined;
};

export type ProfileStackParams = {
  ProfileMain: undefined;
};

const HomeStack = createNativeStackNavigator<HomeStackParams>();
const TasksStack = createNativeStackNavigator<TasksStackParams>();
const TimeStack = createNativeStackNavigator<TimeStackParams>();
const ProfileStack = createNativeStackNavigator<ProfileStackParams>();

const Tab = createBottomTabNavigator();

/* ── Stack navigators per tab ────────────────────────────── */

function HomeStackScreen() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
    </HomeStack.Navigator>
  );
}

function TasksStackScreen() {
  return (
    <TasksStack.Navigator screenOptions={{ headerShown: false }}>
      <TasksStack.Screen name="TasksMain" component={TasksScreen} />
    </TasksStack.Navigator>
  );
}

function TimeStackScreen() {
  return (
    <TimeStack.Navigator screenOptions={{ headerShown: false }}>
      <TimeStack.Screen name="TimeMain" component={TimekeepingScreen} />
    </TimeStack.Navigator>
  );
}

function ProfileStackScreen() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
    </ProfileStack.Navigator>
  );
}

/* ── Tab icon placeholder (text-based) ───────────────────── */

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{label}</Text>
  );
}

/* ── Signed-in tabs ──────────────────────────────────────── */

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: '#e2e8f0',
          paddingBottom: 4,
          height: 56,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackScreen}
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ focused }) => <TabIcon label="A" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Tasks"
        component={TasksStackScreen}
        options={{
          title: t('tabs.tasks'),
          tabBarIcon: ({ focused }) => <TabIcon label="T" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Time"
        component={TimeStackScreen}
        options={{
          title: t('tabs.time'),
          tabBarIcon: ({ focused }) => <TabIcon label="H" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStackScreen}
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ focused }) => <TabIcon label="P" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

/* ── Auth gate: login screen or tabs ─────────────────────── */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {children}
      </View>
    </SafeAreaView>
  );
}

function Root() {
  const { status, profileError, retryProfile, signOut } = useAuth();

  if (status === 'loading') {
    return (
      <Centered>
        <ActivityIndicator size="large" color="#2563eb" />
      </Centered>
    );
  }

  if (status === 'profileError') {
    return (
      <Centered>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#334155', marginBottom: 8 }}>
          {t('auth.profileLoadFailed')}
        </Text>
        <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 20, textAlign: 'center' }}>
          {profileError}
        </Text>
        <TouchableOpacity
          onPress={retryProfile}
          style={{ backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 12 }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>{t('actions.retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => signOut()}>
          <Text style={{ fontSize: 14, color: '#dc2626' }}>{t('auth.signOut')}</Text>
        </TouchableOpacity>
      </Centered>
    );
  }

  if (status === 'signedOut') return <LoginScreen />;

  return (
    <FieldProvider>
      <NavigationContainer>
        <MainTabs />
      </NavigationContainer>
    </FieldProvider>
  );
}

/* ── Root App ────────────────────────────────────────────── */

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Root />
    </AuthProvider>
  );
}
