import { describe, it, expect } from 'vitest';
import { run, getTenant } from './tenant-context';

const baseTenant = { slug: 'acme', schema: 'acme', name: 'Acme Corp' };

describe('tenant-context', () => {
  it('returns null outside of a context', () => {
    expect(getTenant()).toBeNull();
  });

  it('returns the tenant inside run()', async () => {
    let captured: any = undefined;
    await run(baseTenant, async () => {
      captured = getTenant();
    });
    expect(captured).toEqual(baseTenant);
  });

  it('returns null after run() exits', async () => {
    await run(baseTenant, async () => {});
    expect(getTenant()).toBeNull();
  });

  it('propagates tenant through nested async calls', async () => {
    let innerResult: any = undefined;

    async function nested() {
      innerResult = getTenant();
    }

    await run(baseTenant, async () => {
      await nested();
    });

    expect(innerResult).toEqual(baseTenant);
  });

  it('supports arbitrary extra fields on the tenant object', async () => {
    const extendedTenant = { slug: 'acme', schema: 'acme', id: 42, active: true };
    let captured: any = undefined;
    await run(extendedTenant, async () => {
      captured = getTenant();
    });
    expect(captured).toEqual(extendedTenant);
  });

  it('isolates concurrent contexts via AsyncLocalStorage', async () => {
    const tenantA = { slug: 'tenant-a', schema: 'schema_a' };
    const tenantB = { slug: 'tenant-b', schema: 'schema_b' };
    const results: [any, any] = [null, null];

    await Promise.all([
      run(tenantA, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results[0] = getTenant();
      }),
      run(tenantB, async () => {
        results[1] = getTenant();
      }),
    ]);

    expect(results[0]).toEqual(tenantA);
    expect(results[1]).toEqual(tenantB);
  });

  it('does not leak context after parallel run() calls', async () => {
    await Promise.all([
      run(baseTenant, async () => {}),
      run(baseTenant, async () => {}),
    ]);
    expect(getTenant()).toBeNull();
  });
});
