
import { createLogger } from '../utils/logger';
import { Core } from '@strapi/strapi';

// The control table lives exclusively in the public schema — never cloned or mapped.
const EXCLUDED_EXACT = ['multitenancy_tenants'];

// System tables: created as VIEWS in the tenant schema pointing to public.
const SYSTEM_PREFIXES = ['admin_', 'strapi_'];

const SYSTEM_TABLES_EXACT = new Set([
  'up_roles',
  'up_permissions',
  'up_permissions_role_links',
  'up_permissions_role_lnk', // Strapi 5
  'i18n_locale', // i18n plugin: locales are shared
]);

function isSystemTable(name: string) {
  return SYSTEM_PREFIXES.some((p) => name.startsWith(p)) || SYSTEM_TABLES_EXACT.has(name);
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const log = createLogger(strapi);

  return {
    _assertPostgres() {
      const clientType = (strapi.db as any).connection?.client?.config?.client || 'unknown';
      if (!['pg', 'postgres', 'postgresql'].includes(clientType)) {
        throw new Error(`[multitenancy] Schema Manager requires PostgreSQL. Current client: ${clientType}`);
      }
    },

    /**
     * Creates a new PostgreSQL schema
     */
    async createSchema(schemaName: string) {
      this._assertPostgres();
      this._validateName(schemaName);
      const knex = (strapi.db as any).connection;

      await knex.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

      const contentTables = await this._getContentTables(knex);
      log.info(`[multitenancy] Creating schema "${schemaName}" with ${contentTables.length} content tables...`);

      for (const table of contentTables) {
        await knex.raw(`
          CREATE TABLE IF NOT EXISTS "${schemaName}"."${table}"
            (LIKE public."${table}" INCLUDING ALL)
        `);
      }

      await this._replicateForeignKeys(knex, schemaName, contentTables);
      await this._syncSystemViews(knex, schemaName);

      log.info(`[multitenancy] Schema "${schemaName}" created successfully.`);
    },

    /**
     * Drops a PostgreSQL schema with CASCADE (irreversible).
     */
    async dropSchema(schemaName: string) {
      this._assertPostgres();
      this._validateName(schemaName);
      const knex = (strapi.db as any).connection;
      await knex.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      log.info(`[multitenancy] Schema "${schemaName}" dropped.`);
    },

    /**
     * Synchronizes an existing tenant schema
     */
    async syncSchema(schemaName: string) {
      this._assertPostgres();
      this._validateName(schemaName);
      const knex = (strapi.db as any).connection;

      const schemaExists = await this._schemaExists(knex, schemaName);
      if (!schemaExists) {
        log.info(`[multitenancy] Schema "${schemaName}" does not exist. Creating...`);
        await this.createSchema(schemaName);
        return;
      }

      const contentTables = await this._getContentTables(knex);
      let synced = 0;

      for (const table of contentTables) {
        const exists = await knex.schema.withSchema(schemaName).hasTable(table);
        if (!exists) {
          await knex.raw(`
            CREATE TABLE IF NOT EXISTS "${schemaName}"."${table}"
              (LIKE public."${table}" INCLUDING ALL)
          `);
          synced++;
          log.info(`[multitenancy] Table "${table}" added to schema "${schemaName}".`);
        }
      }

      if (synced > 0) {
        await this._replicateForeignKeys(knex, schemaName, contentTables);
      }

      await this._syncNewColumns(knex, schemaName, contentTables);
      await this._syncSystemViews(knex, schemaName);

      if (synced > 0) {
        log.info(`[multitenancy] Schema "${schemaName}": ${synced} new tables synchronized.`);
      }
    },

    /**
     * Synchronizes all active tenant schemas.
     */
    async syncAllSchemas() {
      this._assertPostgres();
      const tenants: any[] = await strapi.plugin('multitenancy').service('tenantManager').getAllTenants();

      if (tenants.length === 0) {
        log.info('[multitenancy] No active tenants to synchronize.');
        return;
      }

      log.info(`[multitenancy] Synchronizing ${tenants.length} tenant schemas...`);

      const results = await Promise.allSettled(tenants.map((t) => this.syncSchema(t.schema)));

      const errors = results
        .map((r, i) => (r.status === 'rejected' ? { tenant: tenants[i], reason: (r as PromiseRejectedResult).reason } : null))
        .filter((x): x is { tenant: any, reason: any } => x !== null);

      errors.forEach(({ tenant, reason }) => {
        log.error(`[multitenancy] Sync failed for "${tenant.slug}": ${reason?.message ?? reason}`);
      });

      log.info(`[multitenancy] Sync complete: ${tenants.length - errors.length}/${tenants.length} OK.`);
    },

    // ─── Private methods ────────────────────────────────────────────────────────

    async _schemaExists(knex: any, schemaName: string) {
      const { rows } = await knex.raw(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = ?`,
        [schemaName]
      );
      return rows.length > 0;
    },

    async _getContentTables(knex: any) {
      const { rows } = await knex.raw(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%'
        ORDER BY tablename
      `);
      return rows
        .map((r: any) => r.tablename)
        .filter((name: string) => !EXCLUDED_EXACT.includes(name) && !isSystemTable(name));
    },

    async _syncSystemViews(knex: any, schemaName: string) {
      const { rows } = await knex.raw(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%'
        ORDER BY tablename
      `);

      const systemTables = rows.map((r: any) => r.tablename).filter(isSystemTable);

      for (const table of systemTables) {
        const { rows: isRealTable } = await knex.raw(
          `SELECT 1 FROM pg_tables WHERE schemaname = ? AND tablename = ?`,
          [schemaName, table]
        );
        if (isRealTable.length > 0) {
          log.info(`[multitenancy] Converting table "${schemaName}"."${table}" to a view...`);
          await knex.raw(`DROP TABLE IF EXISTS "${schemaName}"."${table}" CASCADE`);
        }

        await knex.raw(`
          CREATE OR REPLACE VIEW "${schemaName}"."${table}" AS
          SELECT * FROM public."${table}"
        `);
      }

      log.debug(`[multitenancy] System views synchronized in "${schemaName}".`);
    },

    async _replicateForeignKeys(knex: any, targetSchema: string, tables: string[]) {
      const { rows: fks } = await knex.raw(`
        SELECT
          tc.constraint_name, tc.table_name, kcu.column_name,
          ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = ANY(?)
      `, [tables]);

      for (const fk of fks) {
        if (!tables.includes(fk.foreign_table)) continue;
        const constraintName = `${fk.constraint_name}_${targetSchema}`.substring(0, 63);
        await knex.raw(`
          ALTER TABLE "${targetSchema}"."${fk.table_name}"
          ADD CONSTRAINT "${constraintName}"
          FOREIGN KEY ("${fk.column_name}")
          REFERENCES "${targetSchema}"."${fk.foreign_table}" ("${fk.foreign_column}")
          ON DELETE CASCADE
        `).catch(() => { });
      }
    },

    async _syncNewColumns(knex: any, schemaName: string, tables: string[]) {
      for (const table of tables) {
        const { rows: publicCols } = await knex.raw(`
          SELECT column_name, data_type, column_default, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ?
        `, [table]);

        const { rows: tenantCols } = await knex.raw(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
        `, [schemaName, table]);

        const existing = new Set(tenantCols.map((c: any) => c.column_name));

        for (const col of publicCols) {
          if (existing.has(col.column_name)) continue;
          const nullable = col.is_nullable === 'YES' ? '' : 'NOT NULL';
          const def = col.column_default ? `DEFAULT ${col.column_default}` : '';
          await knex.raw(`
            ALTER TABLE "${schemaName}"."${table}"
            ADD COLUMN IF NOT EXISTS "${col.column_name}" ${col.data_type} ${nullable} ${def}
          `).catch((err: any) => {
            log.warn(`[multitenancy] Column "${col.column_name}" in "${schemaName}"."${table}": ${err.message}`);
          });
        }
      }
    },

    _validateName(name: string) {
      if (!/^[a-z0-9_-]+$/.test(name)) {
        throw new Error(`Invalid schema name: "${name}". Only lowercase letters, numbers, underscores and hyphens are allowed.`);
      }
      const reserved = ['public', 'pg_catalog', 'information_schema', 'pg_toast'];
      if (reserved.includes(name)) {
        throw new Error(`Schema name "${name}" is reserved by PostgreSQL.`);
      }
    },
  };
};
