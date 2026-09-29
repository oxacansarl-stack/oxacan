import { createContext, useContext } from 'react';

export type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'TEAM_LEADER' | 'WORKER';

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  companyId: string;
}

export const CurrentUserContext = createContext<CurrentUser | null>(null);

/** The signed-in user; available on every page rendered inside the authenticated layout. */
export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUser must be used inside the authenticated layout');
  return user;
}
