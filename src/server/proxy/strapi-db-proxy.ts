
import * as tenantContext from '../context/tenant-context';
import { createLogger } from '../utils/logger';
import { Core } from '@strapi/strapi';

/**
 * Strapi 5 uses getSchemaName() and getConnection().withSchema() to qualify
 * table names with a schema. The schema comes from connectionSettings (static config).
 * This proxy overrides getSchemaName() to return the tenant's schema name
 * when executing inside a tenant context.
 */
export function install(strapi: Core.Strapi) {
  const log = createLogger(strapi);
  const db = (strapi as any).db;

  if (!db || typeof db.getSchemaName !== 'function') {
    log.warn('[multitenancy] strapi.db.getSchemaName not found — proxy not installed.');
    return;
  }

  const originalGetSchemaName = db.getSchemaName.bind(db);

  db.getSchemaName = function () {
    const tenant = tenantContext.getTenant();
    if (tenant?.schema) {
      if (!/^[a-z0-9_-]+$/.test(tenant.schema)) {
        throw new Error(
          `[multitenancy] Invalid schema name: "${tenant.schema}"`
        );
      }
      return tenant.schema;
    }
    return originalGetSchemaName();
  };

  log.info('[multitenancy] strapi.db.getSchemaName proxy installed.');
}

export default { install };
