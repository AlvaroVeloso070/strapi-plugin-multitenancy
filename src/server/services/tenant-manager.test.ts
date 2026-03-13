import { describe, it, expect, vi, beforeEach } from 'vitest';
import tenantManagerFactory from './tenant-manager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a chainable Knex query mock.
 * All chain methods return `this`; terminal methods (first/insert/update/orderBy)
 * can be overridden via `overrides`.
 */
function makeKnex(overrides: any = {}): any {
  const chain: any = {
    withSchema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    table: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue([1]),
    update: vi.fn().mockResolvedValue(1),
    orderBy: vi.fn().mockResolvedValue([]),
    schema: {
      withSchema: vi.fn().mockReturnThis(),
      hasTable: vi.fn().mockResolvedValue(false),
      createTable: vi.fn().mockImplementation((_name: string, cb: Function) => {
        // Invoke the table-builder callback with a no-op builder
        const builder: any = new Proxy({}, { get: () => vi.fn().mockReturnThis() });
        cb(builder);
        return Promise.resolve();
      }),
    },
    fn: { now: vi.fn() },
    ...overrides,
  };
  return chain;
}

function makeStrapi(defaultTenant: any = null): any {
  const knex = makeKnex();
  if (defaultTenant !== null) {
    knex.first.mockResolvedValue(defaultTenant);
  }

  const schemaManager = {
    createSchema: vi.fn().mockResolvedValue(undefined),
    dropSchema: vi.fn().mockResolvedValue(undefined),
  };

  const strapi: any = {
    db: { connection: knex },
    config: {
      get: vi.fn((key: string, def?: any) => {
        if (key === 'plugin::multitenancy.cacheTtlMs') return 10_000;
        if (key === 'plugin::multitenancy.debug') return false;
        return def;
      }),
    },
    plugin: vi.fn().mockReturnValue({
      service: vi.fn().mockReturnValue(schemaManager),
    }),
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  strapi._knex = knex;
  strapi._schemaManager = schemaManager;
  return strapi;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('tenant-manager', () => {
  let strapi: any;
  let manager: any;

  beforeEach(() => {
    strapi = makeStrapi();
    manager = tenantManagerFactory({ strapi });
    // Always start each test with a clean cache
    manager.invalidateCache();
  });

  // ── getTenant ──────────────────────────────────────────────────────────────

  describe('getTenant', () => {
    it('returns the tenant when found in DB', async () => {
      const tenant = { slug: 'acme', schema: 'acme', name: 'Acme', active: true };
      strapi._knex.first.mockResolvedValue(tenant);

      const result = await manager.getTenant('acme');

      expect(result).toEqual(tenant);
      expect(strapi._knex.withSchema).toHaveBeenCalledWith('public');
    });

    it('returns null when tenant is not found', async () => {
      strapi._knex.first.mockResolvedValue(undefined);
      const result = await manager.getTenant('ghost');
      expect(result).toBeNull();
    });

    it('caches the result and hits the DB only once for repeated calls', async () => {
      const tenant = { slug: 'acme', schema: 'acme' };
      strapi._knex.first.mockResolvedValue(tenant);

      await manager.getTenant('acme');
      await manager.getTenant('acme');

      expect(strapi._knex.first).toHaveBeenCalledTimes(1);
    });

    it('re-fetches from DB after cache is invalidated', async () => {
      const tenant = { slug: 'acme', schema: 'acme' };
      strapi._knex.first.mockResolvedValue(tenant);

      await manager.getTenant('acme');
      manager.invalidateCache('acme');
      await manager.getTenant('acme');

      expect(strapi._knex.first).toHaveBeenCalledTimes(2);
    });

    it('re-fetches from DB when TTL has expired', async () => {
      const tenant = { slug: 'acme', schema: 'acme' };
      strapi._knex.first.mockResolvedValue(tenant);

      // Set a 0 ms TTL so the cache immediately expires
      strapi.config.get = vi.fn((key: string, def?: any) => {
        if (key === 'plugin::multitenancy.cacheTtlMs') return 0;
        return def;
      });

      await manager.getTenant('acme');
      await manager.getTenant('acme');

      expect(strapi._knex.first).toHaveBeenCalledTimes(2);
    });
  });

  // ── getAllTenants ──────────────────────────────────────────────────────────

  describe('getAllTenants', () => {
    it('queries public schema and returns results', async () => {
      const tenants = [{ slug: 'acme' }, { slug: 'globex' }];
      strapi._knex.orderBy.mockResolvedValue(tenants);

      const result = await manager.getAllTenants();

      expect(strapi._knex.withSchema).toHaveBeenCalledWith('public');
      expect(result).toEqual(tenants);
    });
  });

  // ── createTenant ──────────────────────────────────────────────────────────

  describe('createTenant', () => {
    it('throws when a tenant with that slug already exists', async () => {
      strapi._knex.first.mockResolvedValue({ slug: 'acme', schema: 'acme' });

      await expect(
        manager.createTenant({ slug: 'acme', name: 'Acme', schema: 'acme' })
      ).rejects.toThrow(/already exists/);
    });

    it('throws when the schema name is already in use', async () => {
      strapi._knex.first
        .mockResolvedValueOnce(null)                           // slug is free
        .mockResolvedValueOnce({ slug: 'other', schema: 'acme' }); // schema conflict

      await expect(
        manager.createTenant({ slug: 'new-tenant', name: 'New', schema: 'acme' })
      ).rejects.toThrow(/already in use/);
    });

    it('creates PostgreSQL schema and inserts tenant record', async () => {
      const newTenant = { slug: 'new-tenant', schema: 'new_tenant', name: 'New' };
      strapi._knex.first
        .mockResolvedValueOnce(null)      // slug not taken
        .mockResolvedValueOnce(null)      // schema not taken
        .mockResolvedValueOnce(newTenant); // returned after invalidate + re-fetch

      await manager.createTenant({ slug: 'new-tenant', name: 'New', schema: 'new_tenant' });

      expect(strapi._schemaManager.createSchema).toHaveBeenCalledWith('new_tenant');
      expect(strapi._knex.insert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'new-tenant', schema: 'new_tenant', active: true })
      );
    });
  });

  // ── updateTenant ──────────────────────────────────────────────────────────

  describe('updateTenant', () => {
    it('throws when the tenant does not exist', async () => {
      strapi._knex.first.mockResolvedValue(null);

      await expect(
        manager.updateTenant('ghost', { name: 'New Name' })
      ).rejects.toThrow(/not found/);
    });

    it('throws when the new slug has invalid characters', async () => {
      strapi._knex.first.mockResolvedValue({ slug: 'acme', schema: 'acme' });

      await expect(
        manager.updateTenant('acme', { slug: 'INVALID Slug!' })
      ).rejects.toThrow(/Slug must contain/);
    });

    it('throws when the new slug is already taken', async () => {
      strapi._knex.first
        .mockResolvedValueOnce({ slug: 'acme', schema: 'acme' }) // current tenant found
        .mockResolvedValueOnce({ slug: 'other' });               // new slug is taken

      await expect(
        manager.updateTenant('acme', { slug: 'other' })
      ).rejects.toThrow(/already exists/);
    });

    it('updates the tenant name without changing the slug', async () => {
      const tenant = { slug: 'acme', schema: 'acme', name: 'Acme' };
      strapi._knex.first
        .mockResolvedValueOnce(tenant)                                       // found
        .mockResolvedValueOnce({ ...tenant, name: 'Acme Updated' });         // re-fetch

      await manager.updateTenant('acme', { name: 'Acme Updated' });

      expect(strapi._knex.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Acme Updated' })
      );
    });

    it('updates both slug and name, invalidating both cache entries', async () => {
      const tenant = { slug: 'acme', schema: 'acme', name: 'Acme' };
      strapi._knex.first
        .mockResolvedValueOnce(tenant)       // current exists
        .mockResolvedValueOnce(null)         // new slug is free
        .mockResolvedValueOnce({ slug: 'acme-new', schema: 'acme', name: 'Acme' }); // re-fetch

      await manager.updateTenant('acme', { slug: 'acme-new', name: 'Acme' });

      expect(strapi._knex.update).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'acme-new' })
      );
    });
  });

  // ── deleteTenant ──────────────────────────────────────────────────────────

  describe('deleteTenant', () => {
    it('throws when the tenant does not exist', async () => {
      strapi._knex.first.mockResolvedValue(null);

      await expect(manager.deleteTenant('ghost')).rejects.toThrow(/not found/);
    });

    it('soft-deletes (sets active: false) without dropping the schema', async () => {
      strapi._knex.first.mockResolvedValue({ slug: 'acme', schema: 'acme' });

      await manager.deleteTenant('acme', { dropSchema: false });

      expect(strapi._knex.update).toHaveBeenCalledWith(
        expect.objectContaining({ active: false })
      );
      expect(strapi._schemaManager.dropSchema).not.toHaveBeenCalled();
    });

    it('drops the PostgreSQL schema when dropSchema is true', async () => {
      strapi._knex.first.mockResolvedValue({ slug: 'acme', schema: 'acme_schema' });

      await manager.deleteTenant('acme', { dropSchema: true });

      expect(strapi._schemaManager.dropSchema).toHaveBeenCalledWith('acme_schema');
    });

    it('invalidates the cache after deletion', async () => {
      const tenant = { slug: 'acme', schema: 'acme' };
      strapi._knex.first
        .mockResolvedValueOnce(tenant)   // first getTenant inside deleteTenant
        .mockResolvedValueOnce(null);    // subsequent getTenant after deletion

      await manager.deleteTenant('acme');

      // Cache was cleared — next call should hit the DB again
      await manager.getTenant('acme');
      expect(strapi._knex.first).toHaveBeenCalledTimes(2);
    });
  });

  // ── invalidateCache ────────────────────────────────────────────────────────

  describe('invalidateCache', () => {
    it('clears a single slug entry', async () => {
      const tenant = { slug: 'acme', schema: 'acme' };
      strapi._knex.first.mockResolvedValue(tenant);

      await manager.getTenant('acme');
      manager.invalidateCache('acme');
      await manager.getTenant('acme');

      expect(strapi._knex.first).toHaveBeenCalledTimes(2);
    });

    it('clears all entries when called without arguments', async () => {
      strapi._knex.first.mockResolvedValue({ slug: 'acme', schema: 'acme' });
      await manager.getTenant('acme');

      strapi._knex.first.mockResolvedValue({ slug: 'globex', schema: 'globex' });
      await manager.getTenant('globex');

      manager.invalidateCache(); // clear everything

      await manager.getTenant('acme');
      await manager.getTenant('globex');

      expect(strapi._knex.first).toHaveBeenCalledTimes(4);
    });
  });

  // ── _ensureTable ───────────────────────────────────────────────────────────

  describe('_ensureTable', () => {
    it('creates the control table when it does not exist', async () => {
      strapi._knex.schema.hasTable.mockResolvedValue(false);

      await manager._ensureTable();

      expect(strapi._knex.schema.createTable).toHaveBeenCalled();
    });

    it('skips creation when the table already exists', async () => {
      strapi._knex.schema.hasTable.mockResolvedValue(true);

      await manager._ensureTable();

      expect(strapi._knex.schema.createTable).not.toHaveBeenCalled();
    });
  });
});
