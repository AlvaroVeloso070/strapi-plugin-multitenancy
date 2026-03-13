
import * as tenantContext from '../context/tenant-context';
import { createLogger } from '../utils/logger';
import { Core } from '@strapi/strapi';

export default (config: any, { strapi }: { strapi: Core.Strapi }) => {
  const log = createLogger(strapi);

  return async (ctx: any, next: () => Promise<void>) => {
    // Prefer hostname (reliable with app.proxy = true behind a reverse proxy).
    // Fall back to Origin/Referer when the frontend is on a different subdomain than the API.
    let hostname = ctx.request.hostname;
    let hostnameSource = 'host';

    const rootDomain = strapi.config.get(
      'plugin::multitenancy.rootDomain',
      process.env.ROOT_DOMAIN
    );

    let slug = extractSubdomain(hostname, rootDomain as string);

    // If not resolved via Host header, try Origin/Referer (fallback)
    if (!slug) {
      const origin = ctx.get('Origin') || ctx.get('Referer');
      if (origin) {
        try {
          const originUrl = new URL(origin);
          hostname = originUrl.hostname;
          hostnameSource = 'origin/referer';
          slug = extractSubdomain(hostname, rootDomain as string);
        } catch (_) { }
      }
    }

    const requireTenant = strapi.config.get('plugin::multitenancy.requireTenant', false);

    // No tenant subdomain identified
    if (!slug) {
      // Block access if tenant is required, except for admin and health-check routes
      const isPublicRoute = ctx.path.startsWith('/admin') || ctx.path.startsWith('/_health');
      if (requireTenant && !isPublicRoute) {
        ctx.status = 403;
        ctx.body = {
          error: 'tenant_required',
          message: 'This resource requires a tenant to be identified via hostname or Origin.',
        };
        return;
      }
      return next();
    }

    const tenantService = strapi
      .plugin('multitenancy')
      .service('tenantManager');

    let tenant: any;
    try {
      tenant = await tenantService.getTenant(slug);
    } catch (err: any) {
      log.error(`[multitenancy] Error looking up tenant "${slug}": ${err.message}`);
      ctx.status = 503;
      ctx.body = { error: 'service_unavailable', message: 'Tenant lookup failed.' };
      return;
    }

    if (!tenant) {
      ctx.status = 404;
      ctx.body = {
        error: 'tenant_not_found',
        message: `Tenant "${slug}" does not exist or is inactive.`,
      };
      return;
    }

    // Inject into Koa state for direct access in controllers if needed
    ctx.state.tenant = tenant;

    log.debug(`[multitenancy] ${ctx.method} ${ctx.path} → tenant: ${tenant.slug} (via ${hostnameSource})`);

    // CRITICAL: Execute the entire middleware chain and handler
    // inside the tenant context via AsyncLocalStorage.
    // The strapi-db-proxy reads this context to set the correct withSchema().
    await tenantContext.run(tenant, async () => {
      await next();
    });
  };
};

/**
 * Extracts the subdomain from a hostname given the rootDomain.
 */
function extractSubdomain(hostname: string, rootDomain: string): string | null {
  if (!rootDomain || !hostname) return null;

  const suffix = `.${rootDomain}`;
  if (!hostname.endsWith(suffix)) return null;

  const subdomain = hostname.slice(0, -suffix.length);

  // Reject nested subdomains (e.g.: a.b.myapp.com)
  if (!subdomain || subdomain.includes('.')) return null;

  // Reject slugs with invalid characters
  if (!/^[a-z0-9-]+$/.test(subdomain)) return null;

  return subdomain;
}
