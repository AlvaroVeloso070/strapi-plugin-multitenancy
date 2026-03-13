
import { Core } from '@strapi/strapi';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async findAll(ctx: any) {
    const tenants = await strapi
      .plugin('multitenancy')
      .service('tenantManager')
      .getAllTenants();

    ctx.body = { data: tenants };
  },

  async findOne(ctx: any) {
    const { slug } = ctx.params;
    const tenant = await strapi
      .plugin('multitenancy')
      .service('tenantManager')
      .getTenant(slug);

    if (!tenant) {
      return ctx.notFound(`Tenant "${slug}" not found.`);
    }

    ctx.body = { data: tenant };
  },

  async create(ctx: any) {
    const { slug, name, schema } = ctx.request.body;

    if (!slug || !name || !schema) {
      return ctx.badRequest('Fields "slug", "name", and "schema" are required.');
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return ctx.badRequest(
        'Slug must contain only lowercase letters, numbers, and hyphens.'
      );
    }

    if (!/^[a-z0-9_-]+$/.test(schema)) {
      return ctx.badRequest(
        'Schema name must contain only lowercase letters, numbers, underscores, and hyphens.'
      );
    }

    try {
      const tenant = await strapi
        .plugin('multitenancy')
        .service('tenantManager')
        .createTenant({ slug, name, schema });

      ctx.created({ data: tenant });
    } catch (err: any) {
      strapi.log.error(`[multitenancy] Error creating tenant: ${err.message}`);
      ctx.badRequest(err.message);
    }
  },

  async update(ctx: any) {
    const { slug } = ctx.params;
    const { name, slug: newSlug } = ctx.request.body;

    if (!name || !newSlug) {
      return ctx.badRequest('Fields "name" and "slug" are required.');
    }

    if (!/^[a-z0-9-]+$/.test(newSlug)) {
      return ctx.badRequest(
        'Slug must contain only lowercase letters, numbers, and hyphens.'
      );
    }

    try {
      const tenant = await strapi
        .plugin('multitenancy')
        .service('tenantManager')
        .updateTenant(slug, { name, slug: newSlug });

      ctx.body = { data: tenant };
    } catch (err: any) {
      ctx.badRequest(err.message);
    }
  },

  async delete(ctx: any) {
    const { slug } = ctx.params;
    const { dropSchema = false } = ctx.query;

    try {
      await strapi
        .plugin('multitenancy')
        .service('tenantManager')
        .deleteTenant(slug, { dropSchema: dropSchema === 'true' });

      ctx.body = { data: { slug, deleted: true } };
    } catch (err: any) {
      ctx.badRequest(err.message);
    }
  },

  async sync(ctx: any) {
    try {
      await strapi
        .plugin('multitenancy')
        .service('schemaManager')
        .syncAllSchemas();

      ctx.body = { data: { synced: true } };
    } catch (err: any) {
      strapi.log.error(`[multitenancy] Error during sync: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },
});
