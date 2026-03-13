
import strapiDbProxy from './proxy/strapi-db-proxy';
import { createLogger } from './utils/logger';
import { Core } from '@strapi/strapi';

export default async ({ strapi }: { strapi: Core.Strapi }) => {
  const log = createLogger(strapi);

  // ─── STEP 1: Install the strapi-db-proxy ───────────────────────────────────
  // Strapi 5 uses getSchemaName() + withSchema() to qualify ALL ORM queries.
  strapiDbProxy.install(strapi);

  // ─── STEP 2: Ensure control table exists ───────────────────────────────────
  await strapi.plugin('multitenancy').service('tenantManager').init();

  // ─── STEP 3: Auto-sync all schemas on bootstrap (optional) ─────────────────
  const autoSync = strapi.config.get('plugin::multitenancy.autoSyncOnBootstrap', false);
  if (autoSync) {
    log.info('[multitenancy] autoSyncOnBootstrap enabled — syncing all schemas...');
    await strapi.plugin('multitenancy').service('schemaManager').syncAllSchemas();
  }

  log.info('[multitenancy] Plugin initialized.');
};
