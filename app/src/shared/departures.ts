/**
 * VENDORED from adventure/src/lib/departures.ts (toDepartures,
 * parseDepartureId) at commit 5e0fbfb. Do not edit here — edit the source
 * and re-vendor; adventure's CI pins this (npm run verify:vendored).
 *
 * A destination row carries every nearby airport, not one, so a traveler
 * in New York or London has to pick which they actually fly from (#15).
 * A single-airport city keeps its plain destination id; a multi-airport
 * city expands to one entry per code, id'd `${destinationId}::${IATA}`.
 * The id itself carries the choice, so a departure picked on the web
 * prices identically to one picked in the app.
 */
export interface DepartureRow {
  id: string;
  name: string;
  country: string;
  lat: number | null;
  lng: number | null;
  iata_codes: string[];
}

export interface DepartureCity {
  id: string;
  label: string;
  airport: string;
  coords: { lat: number; lng: number };
}

export function toDepartures(r: DepartureRow): DepartureCity[] {
  const label = r.country ? `${r.name}, ${r.country}` : r.name;
  const coords = { lat: r.lat ?? 0, lng: r.lng ?? 0 };
  const codes = (r.iata_codes ?? []).filter(Boolean);
  if (codes.length <= 1) {
    return [{ id: r.id, label, airport: codes[0] ?? '', coords }];
  }
  return codes.map((code) => ({ id: `${r.id}::${code}`, label, airport: code, coords }));
}
