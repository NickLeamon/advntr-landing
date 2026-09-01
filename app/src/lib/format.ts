/**
 * VENDORED formatting rules from adventure/src/lib/dates.ts at 5e0fbfb —
 * `formatRangeFrom`'s output shape, so a date range reads identically on
 * both surfaces ("Jun 12 – 18", "Jun 28 – Jul 3").
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS_DAY = 86400000;

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatRangeFrom(startIso: string, days: number): string {
  const start = parse(startIso);
  const end = new Date(start.getTime() + Math.max(0, days - 1) * MS_DAY);
  const s = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const e = start.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  return `${s} – ${e}`;
}

export function relativeTime(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
