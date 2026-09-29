export enum UserRole {
  ADMIN = 'ADMIN',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  TEAM_LEADER = 'TEAM_LEADER',
  WORKER = 'WORKER',
}

export enum LicenceTier {
  SAAS = 'saas',
  APPLICATION = 'application',
}

export enum SubscriptionTier {
  SOLO = 'solo',
  EQUIPE = 'equipe',
  ENTREPRISE = 'entreprise',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  EXPORT = 'EXPORT',
}
