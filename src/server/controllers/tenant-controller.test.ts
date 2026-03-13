import { describe, it, expect, vi, beforeEach } from 'vitest';
import tenantControllerFactory from './tenant-controller';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT = { slug: 'acme', schema: 'acme', name: 'Acme Corp' };

function makeServices() {
  const tenantManager = {
    getAllTenants: vi.fn().mockResolvedValue([]),
    getTenant: vi.fn().mockResolvedValue(null),
    createTenant: vi.fn().mockResolvedValue(TENANT),
    updateTenant: vi.fn().mockResolvedValue(TENANT),
    deleteTenant: vi.fn().mockResolvedValue(undefined),
  };
  const schemaManager = {
    syncAllSchemas: vi.fn().mockResolvedValue(undefined),
  };
  return { tenantManager, schemaManager };
}

function makeStrapi(services = makeServices()): any {
  return {
    plugin: vi.fn().mockReturnValue({
      service: vi.fn((name: string) =>
        name === 'tenantManager' ? services.tenantManager : services.schemaManager
      ),
    }),
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _services: services,
  };
}

function makeCtx(overrides: any = {}): any {
  return {
    params: {},
    query: {},
    request: { body: {} },
    state: {},
    body: undefined,
    notFound: vi.fn(),
    badRequest: vi.fn(),
    created: vi.fn(),
    internalServerError: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('tenant-controller', () => {
  let strapi: any;
  let controller: any;
  let services: ReturnType<typeof makeServices>;

  beforeEach(() => {
    services = makeServices();
    strapi = makeStrapi(services);
    controller = tenantControllerFactory({ strapi });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all tenants wrapped in { data }', async () => {
      const tenants = [TENANT, { slug: 'globex', schema: 'globex', name: 'Globex' }];
      services.tenantManager.getAllTenants.mockResolvedValue(tenants);
      const ctx = makeCtx();

      await controller.findAll(ctx);

      expect(ctx.body).toEqual({ data: tenants });
    });

    it('returns an empty array when no tenants exist', async () => {
      const ctx = makeCtx();
      await controller.findAll(ctx);
      expect(ctx.body).toEqual({ data: [] });
    });
  });

  // ── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns 404 when tenant is not found', async () => {
      const ctx = makeCtx({ params: { slug: 'ghost' } });
      await controller.findOne(ctx);
      expect(ctx.notFound).toHaveBeenCalled();
    });

    it('returns the tenant wrapped in { data }', async () => {
      services.tenantManager.getTenant.mockResolvedValue(TENANT);
      const ctx = makeCtx({ params: { slug: 'acme' } });

      await controller.findOne(ctx);

      expect(ctx.body).toEqual({ data: TENANT });
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('returns 400 when slug is missing', async () => {
      const ctx = makeCtx({ request: { body: { name: 'Acme', schema: 'acme' } } });
      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 when name is missing', async () => {
      const ctx = makeCtx({ request: { body: { slug: 'acme', schema: 'acme' } } });
      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 when schema is missing', async () => {
      const ctx = makeCtx({ request: { body: { slug: 'acme', name: 'Acme' } } });
      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 for slug with uppercase characters', async () => {
      const ctx = makeCtx({ request: { body: { slug: 'Acme', name: 'Acme', schema: 'acme' } } });
      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 for slug with spaces', async () => {
      const ctx = makeCtx({ request: { body: { slug: 'my tenant', name: 'T', schema: 'acme' } } });
      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 for schema with spaces', async () => {
      const ctx = makeCtx({ request: { body: { slug: 'acme', name: 'Acme', schema: 'my schema' } } });
      await controller.create(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('creates the tenant when all fields are valid', async () => {
      const ctx = makeCtx({ request: { body: { slug: 'acme', name: 'Acme', schema: 'acme' } } });

      await controller.create(ctx);

      expect(services.tenantManager.createTenant).toHaveBeenCalledWith({ slug: 'acme', name: 'Acme', schema: 'acme' });
      expect(ctx.created).toHaveBeenCalledWith({ data: TENANT });
    });

    it('returns 400 when the service throws (e.g. duplicate slug)', async () => {
      services.tenantManager.createTenant.mockRejectedValue(new Error('already exists'));
      const ctx = makeCtx({ request: { body: { slug: 'acme', name: 'Acme', schema: 'acme' } } });

      await controller.create(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith('already exists');
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('returns 400 when name is missing from the body', async () => {
      const ctx = makeCtx({ params: { slug: 'acme' }, request: { body: { slug: 'acme' } } });
      await controller.update(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 when slug is missing from the body', async () => {
      const ctx = makeCtx({ params: { slug: 'acme' }, request: { body: { name: 'Acme' } } });
      await controller.update(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('returns 400 when the new slug has invalid characters', async () => {
      const ctx = makeCtx({
        params: { slug: 'acme' },
        request: { body: { name: 'Acme', slug: 'INVALID!' } },
      });
      await controller.update(ctx);
      expect(ctx.badRequest).toHaveBeenCalled();
    });

    it('updates the tenant and returns { data }', async () => {
      const updated = { ...TENANT, slug: 'acme-new', name: 'Acme Updated' };
      services.tenantManager.updateTenant.mockResolvedValue(updated);
      const ctx = makeCtx({
        params: { slug: 'acme' },
        request: { body: { name: 'Acme Updated', slug: 'acme-new' } },
      });

      await controller.update(ctx);

      expect(services.tenantManager.updateTenant).toHaveBeenCalledWith('acme', {
        name: 'Acme Updated',
        slug: 'acme-new',
      });
      expect(ctx.body).toEqual({ data: updated });
    });

    it('returns 400 when the service throws', async () => {
      services.tenantManager.updateTenant.mockRejectedValue(new Error('not found'));
      const ctx = makeCtx({
        params: { slug: 'acme' },
        request: { body: { name: 'Acme', slug: 'acme' } },
      });

      await controller.update(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith('not found');
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the tenant with dropSchema: false by default', async () => {
      const ctx = makeCtx({ params: { slug: 'acme' }, query: {} });

      await controller.delete(ctx);

      expect(services.tenantManager.deleteTenant).toHaveBeenCalledWith('acme', { dropSchema: false });
      expect(ctx.body).toEqual({ data: { slug: 'acme', deleted: true } });
    });

    it('passes dropSchema: true when query param equals "true"', async () => {
      const ctx = makeCtx({ params: { slug: 'acme' }, query: { dropSchema: 'true' } });

      await controller.delete(ctx);

      expect(services.tenantManager.deleteTenant).toHaveBeenCalledWith('acme', { dropSchema: true });
    });

    it('returns 400 when the service throws', async () => {
      services.tenantManager.deleteTenant.mockRejectedValue(new Error('not found'));
      const ctx = makeCtx({ params: { slug: 'ghost' }, query: {} });

      await controller.delete(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith('not found');
    });
  });

  // ── sync ───────────────────────────────────────────────────────────────────

  describe('sync', () => {
    it('returns { synced: true } on success', async () => {
      const ctx = makeCtx();

      await controller.sync(ctx);

      expect(services.schemaManager.syncAllSchemas).toHaveBeenCalled();
      expect(ctx.body).toEqual({ data: { synced: true } });
    });

    it('returns 500 when syncAllSchemas throws', async () => {
      services.schemaManager.syncAllSchemas.mockRejectedValue(new Error('Sync failed'));
      const ctx = makeCtx();

      await controller.sync(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('Sync failed');
    });
  });
});
