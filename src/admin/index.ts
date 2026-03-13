import pluginId from './pluginId';

export default {
  register(app) {
    app.createSettingSection(
      {
        id: pluginId,
        intlLabel: {
          id: `${pluginId}.settings.section`,
          defaultMessage: 'Multitenancy',
        },
      },
      [
        {
          id: 'tenants',
          intlLabel: {
            id: `${pluginId}.settings.tenants`,
            defaultMessage: 'Tenants',
          },
          to: `${pluginId}/tenants`,
          Component: () => import('./pages/Tenants'),
          permissions: [],
        },
      ]
    );

    app.registerPlugin({
      id: pluginId,
      name: 'Multitenancy',
    });
  },
  bootstrap() {},
};
