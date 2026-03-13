import { describe, it, expect, vi, beforeEach } from 'vitest';
import schemaManagerFactory from './schema-manager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKnex(): any {
  const raw = vi.fn().mockResolvedValue({ rows: [] });

  return {
    raw,
    schema: {
      withSchema: vi.fn().mockReturnThis(),
      hasTable: vi.fn().mockResolvedValue(false),
    },
    client: { config: { client: 'pg' } },
  };
}

function makeStrapi(getAllTenants: any[] = [], debug = false): any {
  const knex = makeKnex();

  const strapi: any = {
    db: { connection: knex },
    config: {
      get: vi.fn((key: string, def?: any) => {
        if (key === 'plugin::multitenancy.debug') return debug;
        return def;
      }),
    },
    plugin: vi.fn().mockReturnValue({
      service: vi.fn().mockReturnValue({
        getAllTenants: vi.fn().mockResolvedValue(getAllTenants),
      }),
    }),
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  strapi._knex = knex;
  return strapi;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('schema-manager', () => {
  let strapi: any;
  let manager: any;

  beforeEach(() => {
    strapi = makeStrapi();
    manager = schemaManagerFactory({ strapi });
  });

  // ── _validateName ──────────────────────────────────────────────────────────

  describe('_validateName', () => {
    it('accepts a simple lowercase name', () => {
      expect(() => manager._validateName('acme')).not.toThrow();
    });

    it('accepts names with underscores', () => {
      expect(() => manager._validateName('acme_corp')).not.toThrow();
    });

    it('accepts names with hyphens', () => {
      expect(() => manager._validateName('tenant-1')).not.toThrow();
    });

    it('accepts names with numbers', () => {
      expect(() => manager._validateName('tenant123')).not.toThrow();
    });

    it('rejects names with uppercase letters', () => {
      expect(() => manager._validateName('Acme')).toThrow(/Invalid schema name/);
    });

    it('rejects names with spaces', () => {
      expect(() => manager._validateName('acme corp')).toThrow(/Invalid schema name/);
    });

    it('rejects names with dots', () => {
      expect(() => manager._validateName('acme.corp')).toThrow(/Invalid schema name/);
    });

    it('rejects names with exclamation marks', () => {
      expect(() => manager._validateName('acme!')).toThrow(/Invalid schema name/);
    });

    it('rejects "public" as reserved', () => {
      expect(() => manager._validateName('public')).toThrow(/reserved/);
    });

    it('rejects "pg_catalog" as reserved', () => {
      expect(() => manager._validateName('pg_catalog')).toThrow(/reserved/);
    });

    it('rejects "information_schema" as reserved', () => {
      expect(() => manager._validateName('information_schema')).toThrow(/reserved/);
    });

    it('rejects "pg_toast" as reserved', () => {
      expect(() => manager._validateName('pg_toast')).toThrow(/reserved/);
    });
  });

  // ── _assertPostgres ────────────────────────────────────────────────────────

  describe('_assertPostgres', () => {
    it('does not throw when client is "pg"', () => {
      expect(() => manager._assertPostgres()).not.toThrow();
    });

    it('does not throw when client is "postgres"', () => {
      strapi._knex.client.config.client = 'postgres';
      expect(() => manager._assertPostgres()).not.toThrow();
    });

    it('throws for sqlite3 client', () => {
      strapi._knex.client.config.client = 'sqlite3';
      expect(() => manager._assertPostgres()).toThrow(/requires PostgreSQL/);
    });

    it('throws for mysql2 client', () => {
      strapi._knex.client.config.client = 'mysql2';
      expect(() => manager._assertPostgres()).toThrow(/requires PostgreSQL/);
    });

    it('throws when client is unknown', () => {
      strapi._knex.client.config.client = 'unknown';
      expect(() => manager._assertPostgres()).toThrow(/requires PostgreSQL/);
    });
  });

  // ── createSchema ──────────────────────────────────────────────────────────

  describe('createSchema', () => {
    it('rejects an invalid schema name before any DB call', async () => {
      await expect(manager.createSchema('Invalid Name!')).rejects.toThrow(/Invalid schema name/);
      expect(strapi._knex.raw).not.toHaveBeenCalled();
    });

    it('rejects a reserved schema name', async () => {
      await expect(manager.createSchema('public')).rejects.toThrow(/reserved/);
    });

    it('issues CREATE SCHEMA IF NOT EXISTS', async () => {
      // No content tables in public schema
      strapi._knex.raw.mockResolvedValue({ rows: [] });

      await manager.createSchema('acme');

      const calls: string[] = strapi._knex.raw.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((sql) => sql.includes('CREATE SCHEMA IF NOT EXISTS'))).toBe(true);
      expect(calls.some((sql) => sql.includes('"acme"'))).toBe(true);
    });

    it('creates a table for each content table found in public', async () => {
      strapi._knex.raw.mockImplementation((sql: string) => {
        if (sql.includes('pg_tables')) {
          return Promise.resolve({ rows: [{ tablename: 'articles' }, { tablename: 'categories' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.createSchema('acme');

      const calls: string[] = strapi._knex.raw.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS') && sql.includes('"articles"'))).toBe(true);
      expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS') && sql.includes('"categories"'))).toBe(true);
    });

    it('excludes the multitenancy_tenants control table from cloning', async () => {
      strapi._knex.raw.mockImplementation((sql: string) => {
        if (sql.includes('pg_tables')) {
          return Promise.resolve({ rows: [{ tablename: 'multitenancy_tenants' }, { tablename: 'articles' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.createSchema('acme');

      const calls: string[] = strapi._knex.raw.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((sql) => sql.includes('"multitenancy_tenants"') && sql.includes('CREATE TABLE'))).toBe(false);
    });

    it('creates VIEWs for system tables (admin_*, strapi_*)', async () => {
      // _getContentTables → no content tables
      // _syncSystemViews → finds admin_users as a system table
      let callCount = 0;
      strapi._knex.raw.mockImplementation((sql: string) => {
        if (sql.includes('pg_tables')) {
          callCount++;
          if (callCount === 1) {
            // _getContentTables call
            return Promise.resolve({ rows: [] });
          }
          // _syncSystemViews call
          return Promise.resolve({ rows: [{ tablename: 'admin_users' }] });
        }
        if (sql.includes('pg_tables WHERE schemaname = ?')) {
          return Promise.resolve({ rows: [] }); // not a real table in tenant schema
        }
        if (sql.includes('information_schema.table_constraints')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.createSchema('acme');

      const calls: string[] = strapi._knex.raw.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((sql) => sql.includes('CREATE OR REPLACE VIEW') && sql.includes('"admin_users"'))).toBe(true);
    });
  });

  // ── dropSchema ────────────────────────────────────────────────────────────

  describe('dropSchema', () => {
    it('rejects invalid schema name', async () => {
      await expect(manager.dropSchema('Bad Name')).rejects.toThrow(/Invalid schema name/);
    });

    it('issues DROP SCHEMA IF EXISTS CASCADE', async () => {
      await manager.dropSchema('acme');

      const calls: string[] = strapi._knex.raw.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((sql) => sql.includes('DROP SCHEMA IF EXISTS') && sql.includes('CASCADE'))).toBe(true);
      expect(calls.some((sql) => sql.includes('"acme"'))).toBe(true);
    });
  });

  // ── syncSchema ────────────────────────────────────────────────────────────

  describe('syncSchema', () => {
    it('calls createSchema when schema does not exist', async () => {
      // _schemaExists returns false
      strapi._knex.raw.mockImplementation((sql: string) => {
        if (sql.includes('information_schema.schemata')) {
          return Promise.resolve({ rows: [] }); // schema does not exist
        }
        return Promise.resolve({ rows: [] });
      });

      const createSchemaSpy = vi.spyOn(manager, 'createSchema').mockResolvedValue(undefined);

      await manager.syncSchema('acme');

      expect(createSchemaSpy).toHaveBeenCalledWith('acme');
    });

    it('syncs missing tables when schema already exists', async () => {
      strapi._knex.raw.mockImplementation((sql: string) => {
        if (sql.includes('information_schema.schemata')) {
          return Promise.resolve({ rows: [{ schema_name: 'acme' }] }); // exists
        }
        if (sql.includes('pg_tables')) {
          return Promise.resolve({ rows: [{ tablename: 'articles' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      strapi._knex.schema.hasTable.mockResolvedValue(false); // articles missing

      await manager.syncSchema('acme');

      const calls: string[] = strapi._knex.raw.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS') && sql.includes('"articles"'))).toBe(true);
    });
  });

  // ── syncAllSchemas ────────────────────────────────────────────────────────

  describe('syncAllSchemas', () => {
    it('logs info and returns early when no tenants exist', async () => {
      // Re-create manager with debug: true so log.info is active
      strapi = makeStrapi([], true);
      manager = schemaManagerFactory({ strapi });

      await manager.syncAllSchemas();

      expect(strapi.log.info).toHaveBeenCalledWith(
        expect.stringContaining('No active tenants')
      );
    });

    it('calls syncSchema for each active tenant', async () => {
      const tenants = [
        { slug: 'acme', schema: 'acme' },
        { slug: 'globex', schema: 'globex' },
      ];
      strapi.plugin().service().getAllTenants.mockResolvedValue(tenants);

      const syncSpy = vi.spyOn(manager, 'syncSchema').mockResolvedValue(undefined);

      await manager.syncAllSchemas();

      expect(syncSpy).toHaveBeenCalledTimes(2);
      expect(syncSpy).toHaveBeenCalledWith('acme');
      expect(syncSpy).toHaveBeenCalledWith('globex');
    });

    it('logs errors for failed tenants but continues with the rest', async () => {
      // debug: true so log.info (summary) is emitted
      strapi = makeStrapi([], true);
      manager = schemaManagerFactory({ strapi });

      const tenants = [
        { slug: 'acme', schema: 'acme' },
        { slug: 'globex', schema: 'globex' },
      ];
      strapi.plugin().service().getAllTenants.mockResolvedValue(tenants);

      vi.spyOn(manager, 'syncSchema')
        .mockRejectedValueOnce(new Error('Connection lost')) // acme fails
        .mockResolvedValueOnce(undefined);                   // globex succeeds

      await manager.syncAllSchemas();

      expect(strapi.log.error).toHaveBeenCalledWith(
        expect.stringContaining('acme')
      );
      // Sync summary should report 1/2 OK
      expect(strapi.log.info).toHaveBeenCalledWith(
        expect.stringContaining('1/2')
      );
    });

    it('reports all schemas as OK when none fail', async () => {
      // debug: true so log.info (summary) is emitted
      strapi = makeStrapi([], true);
      manager = schemaManagerFactory({ strapi });

      const tenants = [{ slug: 'acme', schema: 'acme' }];
      strapi.plugin().service().getAllTenants.mockResolvedValue(tenants);
      vi.spyOn(manager, 'syncSchema').mockResolvedValue(undefined);

      await manager.syncAllSchemas();

      expect(strapi.log.info).toHaveBeenCalledWith(
        expect.stringContaining('1/1')
      );
    });
  });
});
