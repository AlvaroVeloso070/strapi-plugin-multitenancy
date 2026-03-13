import { describe, it, expect, vi, beforeEach } from 'vitest';
import tenantResolverFactory from './tenant-resolver';
import * as tenantContext from '../context/tenant-context';

const ROOT_DOMAIN = 'myapp.com';
const MOCK_TENANT = { slug: 'acme', schema: 'acme', name: 'Acme Corp' };

function makeStrapi(tenantOverride: any = MOCK_TENANT, configOverrides: any = {}): any {
  const getTenant = vi.fn().mockResolvedValue(tenantOverride);

  const strapi: any = {
    config: {
      get: vi.fn((key: string, def?: any) => {
        if (key === 'plugin::multitenancy.rootDomain') return configOverrides.rootDomain ?? ROOT_DOMAIN;
        if (key === 'plugin::multitenancy.requireTenant') return configOverrides.requireTenant ?? false;
        if (key === 'plugin::multitenancy.debug') return false;
        return def;
      }),
    },
    plugin: vi.fn().mockReturnValue({
      service: vi.fn().mockReturnValue({ getTenant }),
    }),
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  // Expose the inner getTenant mock for assertions
  strapi._getTenantMock = getTenant;
  return strapi;
}

function makeCtx(overrides: any = {}): any {
  return {
    request: { hostname: `acme.${ROOT_DOMAIN}` },
    get: vi.fn().mockReturnValue(''),
    state: {},
    status: 200,
    body: null,
    path: '/api/articles',
    method: 'GET',
    ...overrides,
  };
}

describe('tenant-resolver middleware', () => {
  describe('happy path — tenant resolved via Host header', () => {
    it('calls next() with tenant in ctx.state', async () => {
      const strapi = makeStrapi();
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx();
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(ctx.state.tenant).toMatchObject({ slug: 'acme' });
      expect(next).toHaveBeenCalledOnce();
    });

    it('wraps the entire downstream chain inside tenant context', async () => {
      const strapi = makeStrapi();
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx();
      let capturedTenant: any = null;

      await middleware(ctx, vi.fn().mockImplementation(() => {
        capturedTenant = tenantContext.getTenant();
      }));

      expect(capturedTenant).toMatchObject({ slug: 'acme' });
      // Context must be cleared after the middleware chain finishes
      expect(tenantContext.getTenant()).toBeNull();
    });
  });

  describe('Origin/Referer fallback', () => {
    it('resolves tenant from Origin header when Host has no subdomain', async () => {
      const strapi = makeStrapi();
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx({
        request: { hostname: ROOT_DOMAIN },
        get: vi.fn((key: string) => {
          if (key === 'Origin') return `https://acme.${ROOT_DOMAIN}`;
          return '';
        }),
      });
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(ctx.state.tenant).toMatchObject({ slug: 'acme' });
      expect(next).toHaveBeenCalled();
    });

    it('resolves tenant from Referer header when Origin is absent', async () => {
      const strapi = makeStrapi();
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx({
        request: { hostname: ROOT_DOMAIN },
        get: vi.fn((key: string) => {
          if (key === 'Referer') return `https://acme.${ROOT_DOMAIN}/page`;
          return '';
        }),
      });
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(ctx.state.tenant).toMatchObject({ slug: 'acme' });
    });
  });

  describe('no subdomain — requireTenant: false (default)', () => {
    it('calls next() when no subdomain is found and requireTenant is false', async () => {
      const strapi = makeStrapi(null);
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx({ request: { hostname: ROOT_DOMAIN } });
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(ctx.status).toBe(200);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('no subdomain — requireTenant: true', () => {
    it('returns 403 for a regular API route', async () => {
      const strapi = makeStrapi(null, { requireTenant: true });
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx({ request: { hostname: ROOT_DOMAIN }, path: '/api/articles' });
      const next = vi.fn();

      await middleware(ctx, next);

      expect(ctx.status).toBe(403);
      expect(ctx.body).toMatchObject({ error: 'tenant_required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('allows /admin routes through even without a tenant', async () => {
      const strapi = makeStrapi(null, { requireTenant: true });
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx({ request: { hostname: ROOT_DOMAIN }, path: '/admin/login' });
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('allows /_health route through even without a tenant', async () => {
      const strapi = makeStrapi(null, { requireTenant: true });
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx({ request: { hostname: ROOT_DOMAIN }, path: '/_health' });
      const next = vi.fn().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('tenant lookup errors', () => {
    it('returns 404 when tenant is not found', async () => {
      const strapi = makeStrapi(null);
      strapi._getTenantMock.mockResolvedValue(null);
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx();
      const next = vi.fn();

      await middleware(ctx, next);

      expect(ctx.status).toBe(404);
      expect(ctx.body).toMatchObject({ error: 'tenant_not_found' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when the tenant service throws', async () => {
      const strapi = makeStrapi();
      strapi._getTenantMock.mockRejectedValue(new Error('DB unreachable'));
      const middleware = tenantResolverFactory({}, { strapi });
      const ctx = makeCtx();
      const next = vi.fn();

      await middleware(ctx, next);

      expect(ctx.status).toBe(503);
      expect(ctx.body).toMatchObject({ error: 'service_unavailable' });
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('extractSubdomain (via middleware behaviour)', () => {
  it('rejects nested subdomains (a.b.myapp.com)', async () => {
    const strapi = makeStrapi(null, { requireTenant: false });
    const middleware = tenantResolverFactory({}, { strapi });
    const ctx = makeCtx({ request: { hostname: `a.b.${ROOT_DOMAIN}` } });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(ctx, next);

    // Nested subdomain should not attempt a tenant lookup
    expect(strapi._getTenantMock).not.toHaveBeenCalled();
    expect(ctx.state.tenant).toBeUndefined();
  });

  it('rejects subdomains with uppercase characters', async () => {
    const strapi = makeStrapi(null, { requireTenant: false });
    const middleware = tenantResolverFactory({}, { strapi });
    const ctx = makeCtx({ request: { hostname: `ACME.${ROOT_DOMAIN}` } });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(ctx, next);

    expect(strapi._getTenantMock).not.toHaveBeenCalled();
  });

  it('rejects host that does not match rootDomain', async () => {
    const strapi = makeStrapi(null, { requireTenant: false });
    const middleware = tenantResolverFactory({}, { strapi });
    const ctx = makeCtx({ request: { hostname: 'acme.other-domain.com' } });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(ctx, next);

    expect(strapi._getTenantMock).not.toHaveBeenCalled();
  });

  it('returns null when rootDomain is not configured', async () => {
    const strapi = makeStrapi(null, { rootDomain: undefined });
    strapi.config.get = vi.fn((key: string, def?: any) => {
      if (key === 'plugin::multitenancy.rootDomain') return undefined;
      if (key === 'plugin::multitenancy.requireTenant') return false;
      return def;
    });
    const middleware = tenantResolverFactory({}, { strapi });
    const ctx = makeCtx({ request: { hostname: `acme.${ROOT_DOMAIN}` } });
    const next = vi.fn().mockResolvedValue(undefined);

    await middleware(ctx, next);

    expect(strapi._getTenantMock).not.toHaveBeenCalled();
  });
});
