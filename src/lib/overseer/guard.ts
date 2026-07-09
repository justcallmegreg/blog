/** True when the path is an Overseer route and the console is not enabled. */
export function overseerBlocked(pathname: string, enabled: boolean): boolean {
  const isOverseer = pathname === '/overseer' || pathname.startsWith('/overseer/');
  return isOverseer && !enabled;
}

/**
 * True when the site root should redirect to the Overseer. On the Overseer
 * deployment (OVERSEER_ENABLED=true) the console lives at /overseer, so the bare
 * host `/` should land there rather than the blog homepage.
 */
export function overseerHomeRedirect(pathname: string, enabled: boolean): boolean {
  return enabled && pathname === '/';
}
