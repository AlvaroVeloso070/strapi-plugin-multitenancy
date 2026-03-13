import { describe, it, expect, vi, beforeEach } from 'vitest';
import { install } from './strapi-db-proxy';
import * as tenantContext from '../context/tenant-context';

function makeStrapi(dbOverrides: any = {}): any {
  return {
    db: {
      getSchemaName: vi.fn(() => 'public'),
      ...dbOverrides,
    },
    config: { get: vi.fn(() => false) },
    log: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('strapi-db-proxy', () => {
  it('replaces strapi.db.getSchemaName with a proxy function', () => {
    const strapi = makeStrapi();
    const original = strapi.db.getSchemaName;
    install(strapi);
    expect(strapi.db.getSchemaName).not.toBe(original);
  });

  it('returns the original schema (public) when no tenant is active', () => {
    const strapi = makeStrapi();
    install(strapi);
    expect(strapi.db.getSchemaName()).toBe('public');
  });

  it('returns the tenant schema when inside a tenant context', async () => {
    const strapi = makeStrapi();
    install(strapi);
    const tenant = { slug: 'acme', schema: 'acme_schema' };
    let result: string | undefined;

    await tenantContext.run(tenant, async () => {
      result = strapi.db.getSchemaName();
    });

    expect(result).toBe('acme_schema');
  });

  it('falls back to the original when tenant has no schema (empty string)', async () => {
    const strapi = makeStrapi();
    install(strapi);
    const tenant = { slug: 'acme', schema: '' };
    let result: string | undefined;

    await tenantContext.run(tenant, async () => {
      result = strapi.db.getSchemaName();
    });

    expect(result).toBe('public');
  });

  it('throws for a schema name containing spaces or special chars', async () => {
    const strapi = makeStrapi();
    install(strapi);
    const tenant = { slug: 'bad', schema: 'invalid schema!' };
    let error: Error | undefined;

    await tenantContext.run(tenant, () => {
      try {
        strapi.db.getSchemaName();
      } catch (e: any) {
        error = e;
      }
    });

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/Invalid schema name/);
  });

  it('throws for schema names with uppercase letters', async () => {
    const strapi = makeStrapi();
    install(strapi);
    const tenant = { slug: 'bad', schema: 'MySchema' };
    let error: Error | undefined;

    await tenantContext.run(tenant, () => {
      try {
        strapi.db.getSchemaName();
      } catch (e: any) {
        error = e;
      }
    });

    expect(error).toBeDefined();
  });

  it('accepts valid schema names with underscores and hyphens', async () => {
    const strapi = makeStrapi();
    install(strapi);
    const tenant = { slug: 'acme', schema: 'acme_corp-1' };
    let result: string | undefined;

    await tenantContext.run(tenant, async () => {
      result = strapi.db.getSchemaName();
    });

    expect(result).toBe('acme_corp-1');
  });

  it('warns and skips install when strapi.db is null', () => {
    const strapi = makeStrapi();
    strapi.db = null;
    expect(() => install(strapi)).not.toThrow();
  });

  it('warns and skips install when getSchemaName is not a function', () => {
    const strapi = makeStrapi({ getSchemaName: 'not-a-function' });
    const original = strapi.db.getSchemaName;
    expect(() => install(strapi)).not.toThrow();
    // The non-function value must remain untouched
    expect(strapi.db.getSchemaName).toBe(original);
  });
});
