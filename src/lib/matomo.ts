// Idempotent Matomo loader. Queues the standard tracker config (with the
// heartbeat timer for accurate time-on-page) and injects matomo.js once.
export function loadMatomo(matomoUrl: string, siteId: number): void {
  if (!matomoUrl) return;
  const w = window as unknown as { __matomoLoaded?: boolean; _paq?: unknown[][] };
  if (w.__matomoLoaded) return;
  w.__matomoLoaded = true;

  const u = matomoUrl.replace(/\/+$/, '') + '/';
  const _paq = (w._paq = w._paq || []);
  // Tracker target must be set before the queued trackPageView is processed.
  _paq.push(['setTrackerUrl', u + 'matomo.php']);
  _paq.push(['setSiteId', String(siteId)]);
  _paq.push(['enableHeartBeatTimer']); // accurate dwell time incl. the exit page
  _paq.push(['enableLinkTracking']);
  _paq.push(['trackPageView']);

  const d = document;
  const g = d.createElement('script');
  const s = d.getElementsByTagName('script')[0];
  g.async = true;
  g.src = u + 'matomo.js';
  s.parentNode?.insertBefore(g, s);
}
