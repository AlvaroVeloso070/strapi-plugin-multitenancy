
import { AsyncLocalStorage } from 'async_hooks';

interface Tenant {
  id?: string | number;
  slug: string;
  schema: string;
  name?: string;
  [key: string]: any;
}

interface TenantStore {
  tenant: Tenant;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Executes `fn` within a tenant context.
 */
export function run(tenant: Tenant, fn: () => any) {
  return storage.run({ tenant }, fn);
}

/**
 * Returns the active tenant for the current request context.
 */
export function getTenant(): Tenant | null {
  const store = storage.getStore();
  return store?.tenant ?? null;
}

export default { run, getTenant };
