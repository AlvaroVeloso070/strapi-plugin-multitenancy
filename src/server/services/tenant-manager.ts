
import { createLogger } from '../utils/logger';
import { Core } from '@strapi/strapi';

const TENANTS_TABLE = 'multitenancy_tenants';

interface TenantCacheEntry {
  data: any | null;
  ts: number;
}

// In-memory cache: Map<slug, { data: tenant|null, ts: number }>
const cache = new Map<string, TenantCacheEntry>();

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const log = createLogger(strapi);

  return {
    async init() {
      await this._ensureTable();
      log.info('[multitenancy] TenantManager ready.');
    },

    /**
     * Fetches a tenant by slug with in-memory caching.
     * Returns null if not found or inactive.
     */
    async getTenant(slug: string) {
      const ttl = strapi.config.get('plugin::multitenancy.cacheTtlMs', 10_000) as number;
      const cached = cache.get(slug);

      if (cached && Date.now() - cached.ts < ttl) {
        return cached.data;
      }

      // Force public schema to prevent the knex-proxy from redirecting
      // this query to a tenant schema (the control table always lives in public).
      const tenant = await strapi.db.connection
        .withSchema('public')
        .from(TENANTS_TABLE)
        .where({ slug, active: true })
        .first();

      const result = tenant ?? null;
      cache.set(slug, { data: result, ts: Date.now() });
      return result;
    },

    /**
     * Returns all active tenants ordered by creation date.
     */
    async getAllTenants() {
      // Force public schema for the same reason as getTenant.
      return strapi.db.connection
        .withSchema('public')
        .from(TENANTS_TABLE)
        .where({ active: true })
        .orderBy('created_at', 'asc');
    },

    /**
     * Creates a new tenant: initializes the PostgreSQL schema and persists the record.
     */
    async createTenant({ slug, name, schema }: { slug: string, name: string, schema: string }) {
      const existing = await this.getTenant(slug);
      if (existing) {
        throw new Error(`Tenant with slug "${slug}" already exists.`);
      }

      // Check schema uniqueness directly (schema is not the lookup key)
      const schemaConflict = await strapi.db.connection
        .withSchema('public')
        .from(TENANTS_TABLE)
        .where({ schema, active: true })
        .first();
      if (schemaConflict) {
        throw new Error(`Schema "${schema}" is already in use by another tenant.`);
      }

      const schemaManager = strapi
        .plugin('multitenancy')
        .service('schemaManager');

      // 1. Create and initialize the PostgreSQL schema
      await schemaManager.createSchema(schema);

      // 2. Persist the tenant record in the public schema
      await strapi.db.connection
        .withSchema('public')
        .table(TENANTS_TABLE)
        .insert({
          slug,
          name,
          schema,
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
        });

      this.invalidateCache(slug);
      return this.getTenant(slug);
    },

    /**
     * Updates a tenant's name and/or slug. The schema name is immutable.
     */
    async updateTenant(slug: string, { name, slug: newSlug }: { name?: string, slug?: string }) {
      const tenant = await this.getTenant(slug);
      if (!tenant) throw new Error(`Tenant "${slug}" not found.`);

      const updates: any = { updated_at: new Date() };

      if (name !== undefined) updates.name = name;

      if (newSlug && newSlug !== slug) {
        if (!/^[a-z0-9-]+$/.test(newSlug)) {
          throw new Error('Slug must contain only lowercase letters, numbers, and hyphens.');
        }
        const conflict = await this.getTenant(newSlug);
        if (conflict) throw new Error(`Tenant with slug "${newSlug}" already exists.`);
        updates.slug = newSlug;
      }

      await strapi.db.connection
        .withSchema('public')
        .table(TENANTS_TABLE)
        .where({ slug })
        .update(updates);

      this.invalidateCache(slug);
      if (updates.slug) this.invalidateCache(updates.slug);

      return this.getTenant(updates.slug ?? slug);
    },

    /**
     * Deactivates a tenant. With dropSchema: true, physically removes the PostgreSQL schema.
     * WARNING: dropSchema is irreversible.
     */
    async deleteTenant(slug: string, { dropSchema = false }: { dropSchema?: boolean } = {}) {
      const tenant = await this.getTenant(slug);
      if (!tenant) throw new Error(`Tenant "${slug}" not found.`);

      await strapi.db.connection
        .withSchema('public')
        .table(TENANTS_TABLE)
        .where({ slug })
        .update({ active: false, updated_at: new Date() });

      if (dropSchema) {
        const schemaManager = strapi
          .plugin('multitenancy')
          .service('schemaManager');
        await schemaManager.dropSchema(tenant.schema);
      }

      this.invalidateCache(slug);
    },

    /**
     * Clears the in-memory cache for a specific slug or entirely.
     */
    invalidateCache(slug?: string) {
      if (slug) cache.delete(slug);
      else cache.clear();
    },

    /**
     * Creates the tenant control table in the public schema if it does not exist (idempotent).
     */
    async _ensureTable() {
      const knex = (strapi.db as any).connection;

      const exists = await knex.schema.withSchema('public').hasTable(TENANTS_TABLE);

      if (!exists) {
        await knex.schema.withSchema('public').createTable(TENANTS_TABLE, (t: any) => {
          t.increments('id').primary();
          t.string('slug', 100).notNullable().unique()
            .comment('Subdomain that identifies the tenant');
          t.string('name', 255).notNullable()
            .comment('Display name of the tenant');
          t.string('schema', 100).notNullable()
            .comment('PostgreSQL schema name');
          t.boolean('active').defaultTo(true).notNullable();
          t.timestamp('created_at').defaultTo(knex.fn.now());
          t.timestamp('updated_at').defaultTo(knex.fn.now());

          t.index(['slug'], 'idx_mt_tenants_slug');
        });

        log.info(`[multitenancy] Control table "${TENANTS_TABLE}" created in public schema.`);
      }
    },
  };
};
