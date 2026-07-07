// Estimate reading time from raw post text. 200 wpm is the usual prose default;
// the result feeds the reading-time badge shown next to a post's title.
export function estimateReadingMinutes(text: string, wpm = 200): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / wpm));
}
