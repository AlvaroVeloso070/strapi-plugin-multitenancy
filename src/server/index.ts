
import bootstrap from './bootstrap';
import tenantResolver from './middlewares/tenant-resolver';
import tenantManager from './services/tenant-manager';
import schemaManager from './services/schema-manager';
import tenantController from './controllers/tenant-controller';
import adminRoutes from './routes/admin';

export default {
  register({ strapi }) {
    // Register custom types, policies, etc. (future expansion)
  },

  async bootstrap(context) {
    return bootstrap(context);
  },

  middlewares: {
    'tenant-resolver': tenantResolver,
  },

  services: {
    tenantManager,
    schemaManager,
  },

  controllers: {
    tenantController,
  },

  routes: {
    admin: adminRoutes,
  },
};
