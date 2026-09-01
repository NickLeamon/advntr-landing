/**
 * The departure-airport picker's data. Same source as the app's:
 * catalog_destinations, world-readable to signed-in users under RLS, so
 * this queries it directly. Requires a session — which is exactly when the
 * join flow asks for it.
 */
import { supabase } from './supabase';
import { toDepartures, type DepartureCity, type DepartureRow } from '../shared/departures';

export async function searchDepartures(query: string, limit = 8): Promise<DepartureCity[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('catalog_destinations')
    .select('id,name,country,lat,lng,iata_codes')
    .ilike('name', `${q}%`)
    .not('iata_codes', 'eq', '{}')
    .limit(limit);
  if (error) throw error;
  return (data ?? []).flatMap((r) => toDepartures(r as DepartureRow)).slice(0, limit);
}
