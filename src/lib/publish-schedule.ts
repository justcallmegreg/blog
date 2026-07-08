// Resolve a post's `publishAt` frontmatter value into a UTC instant + local day.
// A bare local datetime (no offset) is interpreted as wall-clock time in the
// site's configured IANA timezone, DST-correct. A value with an explicit offset
// or a trailing `Z` is used as-is. Anything unparseable — including an invalid
// timezone — is reported as `invalid` so the caller can hide the post and warn.

export type PublishAtResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'scheduled'; instant: string; day: string };

interface Wall {
  y: number; mo: number; d: number; h: number; mi: number; s: number;
}

// YYYY-MM-DD, a `T` or space separator, HH:MM, optional :SS, optional offset.
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

export function parsePublishAt(
  value: string | undefined,
  timezone: string
): PublishAtResult {
  if (value == null || value.trim() === '') return { kind: 'none' };
  const m = DATETIME.exec(value.trim());
  if (!m) return { kind: 'invalid' };
  const [, y, mo, d, h, mi, s, offset] = m;
  const sec = s ?? '00';

  let instantMs: number;
  if (offset) {
    instantMs = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`);
    if (Number.isNaN(instantMs)) return { kind: 'invalid' };
  } else {
    const ms = wallClockToUtc(
      { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +sec },
      timezone
    );
    if (ms == null) return { kind: 'invalid' };
    instantMs = ms;
  }

  // Reject out-of-range calendar values (e.g. month 13): if the parsed instant,
  // re-read in UTC, doesn't round-trip the input components, the date was invalid.
  const day = localDay(instantMs, timezone);
  if (day == null) return { kind: 'invalid' };
  return { kind: 'scheduled', instant: new Date(instantMs).toISOString(), day };
}

// Convert wall-clock components in `timezone` to a UTC epoch (ms), DST-correct.
// Treat the components as if UTC, see how that instant renders in the zone, and
// correct by the difference. One pass suffices except at DST edges, so do two.
function wallClockToUtc(w: Wall, timezone: string): number | null {
  // DST edges: a nonexistent wall time (spring-forward gap) resolves to a
  // deterministic nearby instant, and an ambiguous one (fall-back fold) resolves
  // to a single deterministic occurrence. Neither is reported as invalid — for a
  // publish schedule, a ~1h resolution of an impossible/ambiguous time is fine.
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  if (Number.isNaN(asUtc)) return null;
  // Reject components Date.UTC silently rolled over — not just day-in-month
  // overflow (month 13, day 40) but also out-of-range h/mi/s (e.g. "09:70",
  // which would otherwise be reinterpreted as 10:10 without changing the day).
  const back = zoneParts(asUtc, 'UTC');
  if (
    !back ||
    back.y !== w.y || back.mo !== w.mo || back.d !== w.d ||
    back.h !== w.h || back.mi !== w.mi || back.s !== w.s
  ) {
    return null;
  }

  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const off = zoneOffsetMs(guess, timezone);
    if (off == null) return null;
    const next = asUtc - off;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

// The zone's UTC offset (ms) at a given instant.
function zoneOffsetMs(instantMs: number, timezone: string): number | null {
  const p = zoneParts(instantMs, timezone);
  if (!p) return null;
  const asIfUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - instantMs;
}

// Break a UTC instant into calendar/clock parts as seen in `timezone`.
// Returns null for an invalid timezone (Intl throws).
function zoneParts(instantMs: number, timezone: string): Wall | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(instantMs)) p[part.type] = part.value;
    let hour = +p.hour;
    if (hour === 24) hour = 0; // some engines render midnight as "24"
    return { y: +p.year, mo: +p.month, d: +p.day, h: hour, mi: +p.minute, s: +p.second };
  } catch {
    return null;
  }
}

function localDay(instantMs: number, timezone: string): string | null {
  const p = zoneParts(instantMs, timezone);
  if (!p) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}
