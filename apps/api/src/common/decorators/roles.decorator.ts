import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// Role groups from PRD §3.1–3.2. Routes without @Roles default to OFFICE_ROLES (see RolesGuard).
export const ADMIN_ONLY = ['ADMIN'];
export const OFFICE_ROLES = ['ADMIN', 'PROJECT_MANAGER'];
export const SITE_LEAD_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'];
export const ALL_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'];
