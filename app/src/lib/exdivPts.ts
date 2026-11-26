export interface ExdivPointEvent {
  d: string;
  code: string;
  name: string;
  cash: number;
  pts: number;
  weight: number;
}

export interface ExdivPointsData {
  meta: {
    date: string;
    to: string;
    rows: number;
    totalPoints: number;
    note: string;
  };
  events: ExdivPointEvent[];
}

/** Only adjust a basis measured on the same date as the estimate snapshot. */
export function knownExdivPoints(data: ExdivPointsData | null | undefined, basisDate: string): number | null {
  if (!data || data.meta.date !== basisDate || data.events.length === 0
      || !Number.isFinite(data.meta.totalPoints) || data.meta.totalPoints <= 0) return null;
  return data.meta.totalPoints;
}
