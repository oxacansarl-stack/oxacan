import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';

import HomeScreen from './screens/HomeScreen';
import TasksScreen from './screens/TasksScreen';
import TimekeepingScreen from './screens/TimekeepingScreen';
import ProfileScreen from './screens/ProfileScreen';

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

/* ── Root App ────────────────────────────────────────────── */

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
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
            tabBarIcon: ({ focused }) => <TabIcon label="H" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Tasks"
          component={TasksStackScreen}
          options={{
            tabBarIcon: ({ focused }) => <TabIcon label="T" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Time"
          component={TimeStackScreen}
          options={{
            tabBarIcon: ({ focused }) => <TabIcon label="C" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileStackScreen}
          options={{
            tabBarIcon: ({ focused }) => <TabIcon label="P" focused={focused} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
