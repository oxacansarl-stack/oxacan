import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  companyId?: string;
  userId?: string;
  system?: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function currentTenant(): TenantStore | undefined {
  return tenantStorage.getStore();
}

/** Mutates the request-scoped store so every later DB checkout in this request uses the tenant. */
export function setTenant(companyId: string, userId?: string): void {
  const store = tenantStorage.getStore();
  if (store) {
    store.companyId = companyId;
    store.userId = userId;
  }
}

/** Runs fn with RLS bypassed. Only for lookups that must happen before the tenant is known. */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ ...tenantStorage.getStore(), system: true }, fn);
}
