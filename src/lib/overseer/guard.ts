/** True when the path is an Overseer route and the console is not enabled. */
export function overseerBlocked(pathname: string, enabled: boolean): boolean {
  const isOverseer = pathname === '/overseer' || pathname.startsWith('/overseer/');
  return isOverseer && !enabled;
}
