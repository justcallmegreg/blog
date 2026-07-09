import { defineMiddleware } from 'astro:middleware';
import { overseerBlocked, overseerHomeRedirect } from './lib/overseer/guard';

export const onRequest = defineMiddleware((context, next) => {
  const enabled = process.env.OVERSEER_ENABLED === 'true';
  if (overseerBlocked(context.url.pathname, enabled)) {
    return new Response('Not found', { status: 404 });
  }
  // On the Overseer deployment, the bare host lands on the console (/overseer),
  // not the blog homepage.
  if (overseerHomeRedirect(context.url.pathname, enabled)) {
    return context.redirect('/overseer', 302);
  }
  return next();
});
