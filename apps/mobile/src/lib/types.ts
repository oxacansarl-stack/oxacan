export type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'TEAM_LEADER' | 'WORKER';

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  companyId: string;
}

export interface Company {
  id: string;
  name: string;
}

/** Field roles get no monetary fields from the API; the app never renders money. */
export interface Project {
  id: string;
  reference: string;
  name: string;
  status: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'validated' | 'cancelled';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: string;
  progressPercent: number;
  assignedTo: string | null;
  plannedEnd: string | null;
}

export interface TimeEntry {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  date: string;
  startTime: string;
  endTime: string | null;
  totalMinutes: number | null;
  category: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | string;
  project?: { id: string; name: string; reference: string } | null;
}

export interface WeeklySummary {
  userId: string;
  totalNormal: number;
  totalOvertime: number;
  totalTravel: number;
}
