import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInGeometry, distanceToEdgesM, distanceToGeometryM, nearbyZones, zonesAtPoint, normalizeAll } from '../src/engine/index.js';
import * as F from './engine.fixtures.js';

const donut = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};

test('point in polygon with holes and multipolygon', () => {
  assert.ok(pointInGeometry([1, 1], donut));
  assert.ok(!pointInGeometry([5, 5], donut));
  assert.ok(!pointInGeometry([11, 5], donut));
  const multi = { type: 'MultiPolygon', coordinates: [donut.coordinates, [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]]] };
  assert.ok(pointInGeometry([20.5, 20.5], multi));
  assert.ok(!pointInGeometry([5, 5], multi));
  assert.ok(pointInGeometry([1, 1], multi));
});

test('distance to edges in meters', () => {
  const sq = F.square(-80.12, 26.10, 0.01);
  // 0.001 deg lat north of the top edge ~ 111 m
  const d = distanceToEdgesM([-80.115, 26.111], sq);
  assert.ok(Math.abs(d - 111.2) < 1, `got ${d}`);
  assert.equal(distanceToGeometryM([-80.115, 26.105], sq), 0);
  // 0.001 deg lon east at lat 26.105 ~ 99.9 m
  const e = distanceToEdgesM([-80.109, 26.105], sq);
  assert.ok(Math.abs(e - 99.9) < 1, `got ${e}`);
});

test('nearbyZones / zonesAtPoint', () => {
  const zones = normalizeAll([{ type: 'FeatureCollection', features: [F.browardSS25, F.ssWknd, F.mdSS30] }]);
  const near = nearbyZones(zones, [-80.115, 26.111], 200);
  assert.deepEqual(near.map((n) => n.zone.id), ['fwc68c-50']);
  const wider = nearbyZones(zones, [-80.115, 26.111], 2000);
  assert.deepEqual(wider.map((n) => n.zone.id), ['fwc68c-50', 'fwc68c-51']);
  assert.deepEqual(nearbyZones(zones, [-80.115, 26.111], 2000, (z) => z.id !== 'fwc68c-50').map((n) => n.zone.id), ['fwc68c-51']);
  assert.deepEqual(zonesAtPoint(zones, [-80.195, 25.805]).map((z) => z.id), ['fwc68c-70']);
});
