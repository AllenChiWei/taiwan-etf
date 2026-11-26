import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownExdivPoints, type ExdivPointsData } from '../src/lib/exdivPts.ts';

const estimate: ExdivPointsData = {
  meta: { date: '2026-11-25', to: '2026-12-16', rows: 1, totalPoints: 42.5, note: '下限' },
  events: [{ d: '2026-12-01', code: '2330', name: '台積電', cash: 5, pts: 42.5, weight: 0.4 }],
};

test('only returns known points for a matching basis date with dividend events', () => {
  assert.equal(knownExdivPoints(estimate, '2026-11-25'), 42.5);
  assert.equal(knownExdivPoints(estimate, '2026-11-26'), null);
  assert.equal(knownExdivPoints({ ...estimate, events: [] }, '2026-11-25'), null);
});
