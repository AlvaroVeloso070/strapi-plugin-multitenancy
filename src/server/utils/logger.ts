
import { Core } from '@strapi/strapi';

/**
 * Creates a logger scoped to the multitenancy plugin.
 */
export function createLogger(strapi: Core.Strapi) {
  const isDebug = strapi.config.get('plugin::multitenancy.debug', false);

  return {
    info:  (msg: string) => { if (isDebug) strapi.log.info(msg); },
    debug: (msg: string) => { if (isDebug) strapi.log.debug(msg); },
    warn:  (msg: string) => strapi.log.warn(msg),   // always shown
    error: (msg: string) => strapi.log.error(msg),  // always shown
  };
}
