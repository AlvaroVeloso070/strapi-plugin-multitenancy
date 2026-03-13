/**
 * Base path for the multitenancy plugin API routes.
 * The Strapi admin useFetchClient makes requests relative to the origin.
 * Run `npx strapi routes:list` to confirm the exact path if you encounter 404s.
 */
export const API_PREFIX = '/multitenancy';

export const getTenantsUrl = () => `${API_PREFIX}/tenants`;
export const getTenantUrl = (slug) => `${API_PREFIX}/tenants/${slug}`;
export const getSyncUrl = () => `${API_PREFIX}/sync`;
