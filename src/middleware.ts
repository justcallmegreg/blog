import { defineMiddleware } from 'astro:middleware';
import { overseerBlocked } from './lib/overseer/guard';

export const onRequest = defineMiddleware((context, next) => {
  if (overseerBlocked(context.url.pathname, process.env.OVERSEER_ENABLED === 'true')) {
    return new Response('Not found', { status: 404 });
  }
  return next();
});
