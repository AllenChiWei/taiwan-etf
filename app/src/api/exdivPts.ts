/* Known announced listed-stock cash dividends affecting the front-month TAIEX basis. */
import type { ExdivPointsData } from '../lib/exdivPts.ts';
export type { ExdivPointsData } from '../lib/exdivPts.ts';

/** Deployment may not have generated this optional estimate; 404 simply hides it. */
export async function fetchExdivPoints(signal?: AbortSignal): Promise<ExdivPointsData | null> {
  const url = `${import.meta.env.BASE_URL}data/exdiv_pts.json`;
  const response = await fetch(url, { signal, cache: 'no-cache' });
  if (response.status === 404 || !response.ok) return null;
  try {
    const value: unknown = await response.json();
    const data = value as Partial<ExdivPointsData> | null;
    if (!data?.meta?.date || !data.meta.to || !Array.isArray(data.events)
        || !Number.isFinite(data.meta.totalPoints)) return null;
    return data as ExdivPointsData;
  } catch {
    return null;
  }
}
