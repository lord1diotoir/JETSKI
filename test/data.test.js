// Data contract tests for public/data/* (see SPEC.md). Run `node scripts/build-data.mjs` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const BBOX = [-80.55, 25.30, -80.05, 26.35];

function geomBbox(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  walk(g.coordinates);
  return b;
}
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
function maxDecimals(c) {
  if (typeof c[0] === 'number') return Math.max(...c.map((x) => (String(x).split('.')[1] || '').length));
  return Math.max(...c.map(maxDecimals));
}

const manatee = load('public/data/manatee.geojson');
const bra = load('public/data/bra.geojson');
const dig = load('public/data/digitized.geojson');
const uscg = load('public/data/uscg_points.json');
const { ramps } = load('public/data/ramps.json');
const rawMd = load('data/raw/manatee_md.geojson');

test('feature counts', () => {
  const broward = manatee.features.filter((f) => f.properties.COUNTY === 'BROWARD');
  const md = manatee.features.filter((f) => f.properties.COUNTY === 'MIAMI-DADE');
  assert.equal(broward.length, 23);
  const mdInBbox = rawMd.features.filter((f) => overlaps(geomBbox(f.geometry), BBOX));
  assert.ok(md.length > 0 && md.length <= 47);
  assert.ok(md.length <= mdInBbox.length);
  assert.ok(md.length >= mdInBbox.length - 2, 'only envelope-but-not-shape misses may be dropped');
  assert.equal(manatee.features.length, 23 + md.length);
  assert.equal(manatee.metadata.count, manatee.features.length);
  assert.equal(bra.features.length, 20);
  assert.equal(bra.metadata.count, 20);
  assert.equal(dig.features.length, 3);
});

test('metadata present', () => {
  for (const fc of [manatee, bra, dig]) {
    assert.equal(fc.type, 'FeatureCollection');
    for (const k of ['source', 'url', 'fetched', 'count', 'notes']) assert.ok(k in fc.metadata, k);
    assert.equal(fc.metadata.fetched, '2026-11-16');
  }
});

test('all features intersect the clip bbox; coordinates rounded to 6 decimals', () => {
  for (const fc of [manatee, bra, dig]) {
    for (const f of fc.features) {
      assert.ok(overlaps(geomBbox(f.geometry), BBOX), f.properties._id);
      assert.ok(maxDecimals(f.geometry.coordinates) <= 6, f.properties._id);
    }
  }
});

test('ids, layers and statuses', () => {
  for (const f of manatee.features) {
    assert.equal(f.properties._layer, 'manatee');
    assert.equal(f.properties._id, `fwc68c-${f.properties.OBJECTID}`);
    for (const k of ['CLASS1_68C', 'DATE1_68C', 'CLASS2_68C', 'DATE2_68C', 'SECT_68C', 'TEXT_68C', 'NOTES_68C', 'COUNTY', 'last_edited_date']) {
      assert.ok(k in f.properties, k);
    }
  }
  for (const f of bra.features) {
    assert.equal(f.properties._layer, 'bra');
    assert.equal(f.properties._id, `fwc68d-${f.properties.OBJECTID}`);
    assert.equal(f.properties._status, 'gis');
    if (f.properties.OBJECTID === 152) assert.match(f.properties._statusNote, /Confirmed in force/);
  }
  const ids = new Set([...manatee.features, ...bra.features, ...dig.features].map((f) => f.properties._id));
  assert.equal(ids.size, manatee.features.length + bra.features.length + dig.features.length, 'unique _id');
});

test('manatee seasons per county', () => {
  for (const f of manatee.features) {
    const p = f.properties;
    const seasonal = p.DATE1_68C !== 'JAN 1 - DEC 31' || p.DATE2_68C !== 'JAN 1 - DEC 31';
    if (!seasonal) continue;
    if (p.COUNTY === 'BROWARD') {
      assert.equal(p.DATE1_68C, 'NOV 15 - MAR 31', p._id);
      assert.equal(p.DATE2_68C, 'APR 1 - NOV 14', p._id);
    } else {
      assert.equal(p.COUNTY, 'MIAMI-DADE');
      assert.equal(p.DATE1_68C, 'NOV 15 - APR 30', p._id);
      assert.equal(p.DATE2_68C, 'MAY 1 - NOV 14', p._id);
    }
  }
});

test('digitized features: ids, properties, valid closed rings', () => {
  const want = ['uscg-760-fixed', 'uscg-765-rna', 'fwc68d-lauderdale-beach-icw'];
  const byId = Object.fromEntries(dig.features.map((f) => [f.properties._id, f]));
  for (const id of want) {
    const f = byId[id];
    assert.ok(f, id);
    const p = f.properties;
    assert.ok(['digitized', 'gis'].includes(p._status), id);
    assert.equal(p.schedule, 'At All Times');
    assert.ok(['No Entry Without COTP Permission', 'Slow Speed', 'Slow Speed Minimum Wake'].includes(p.restriction));
    for (const k of ['_layer', 'name', 'rule', 'ruleUrl', 'notes', 'method']) assert.ok(p[k], `${id}.${k}`);
    const rs = rings(f.geometry);
    assert.ok(rs.length >= 1, id);
    for (const r of rs) {
      assert.ok(r.length >= 4, `${id} ring has >= 4 positions`);
      assert.deepEqual(r[0], r[r.length - 1], `${id} ring closed`);
      for (const [lon, lat] of r) assert.ok(lon < -80 && lon > -80.2 && lat > 26 && lat < 26.2, `${id} in Port Everglades / Ft Lauderdale area`);
    }
  }
  assert.equal(byId['uscg-760-fixed'].properties._layer, 'uscg');
  assert.equal(byId['uscg-760-fixed'].properties._status, 'gis');
  assert.match(byId['uscg-760-fixed'].properties.method, /NOAA ENC/);
  assert.equal(byId['uscg-765-rna'].properties.restriction, 'Slow Speed');
  assert.equal(byId['uscg-765-rna'].properties._status, 'gis');
  assert.equal(byId['uscg-760-fixed'].properties.restriction, 'No Entry Without COTP Permission');
  assert.equal(byId['fwc68d-lauderdale-beach-icw'].properties._status, 'digitized');
  const lb = byId['fwc68d-lauderdale-beach-icw'];
  assert.equal(lb.properties._layer, 'bra');
  assert.equal(lb.properties.restriction, 'Slow Speed Minimum Wake');
  assert.match(lb.properties.notes, /verified against FAC 68D-24\.008\(1\)\(a\)15\./);
  assert.match(lb.properties.rule, /\(1\)\(a\)15\./);
  const b = geomBbox(lb.geometry);
  assert.ok(b[1] >= 26.142 && b[3] <= 26.165, `Lauderdale Beach lat extent ${b[1]}..${b[3]}`);
  assert.ok(b[0] >= -80.112 && b[2] <= -80.100, 'Lauderdale Beach restricted to the ICW');
});

test('uscg_points', () => {
  assert.equal(uscg.cotpPhone, '305-535-4472');
  assert.equal(uscg.vhf, 16);
  const [lon, lat] = uscg.buoyPE;
  assert.ok(Math.abs(lon - -80.079444) < 1e-5 && Math.abs(lat - 26.091667) < 1e-5);
  assert.equal(uscg.carrierMooring.length, 2);
  assert.ok(uscg.moving.length >= 3);
  assert.ok(uscg.moving.some((m) => m.aheadYd === 700 && m.asternYd === 500 && m.abeamYd === 350));
  assert.ok(uscg.moving.some((m) => m.radiusYd === 100));
  const area = uscg.portEvergladesAlertArea;
  assert.equal(area.type, 'Polygon');
  const ring = area.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  const b = geomBbox(area);
  assert.ok(b[0] <= lon && lon <= b[2] && b[1] <= lat && lat <= b[3], 'alert area contains Buoy PE');
});

test('ramps curated', () => {
  const byOid = Object.fromEntries(ramps.map((r) => [r.fwc.OBJECTID, r]));
  for (const oid of [142, 128, 137, 186, 195, 155, 164]) assert.ok(!byOid[oid], `excluded ramp ${oid} absent`);
  for (const r of ramps) {
    assert.notEqual(r.fwc.RampType, 'Hand Launch Only', r.name);
    assert.equal(r.fwc.WaterType, 'Salt or Brackish Water', r.name);
    assert.ok(['open', 'closed', 'verify'].includes(r.status));
    assert.ok(['fwc-inventory', 'official+inventory'].includes(r.source));
    assert.equal(typeof r.pwcDefault, 'boolean');
    assert.ok(Array.isArray(r.conflicts) && Array.isArray(r.notes));
    assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lon));
    assert.ok(!Object.keys(r).some((k) => /capacity/i.test(k)), 'no invented capacity fields');
  }
  for (const oid of [123, 127, 180, 150, 161, 154, 187, 132, 158, 151, 149, 156, 162, 159]) assert.ok(byOid[oid], `ramp ${oid} present`);
  assert.equal(byOid[158].status, 'closed');
  assert.ok(byOid[132].conflicts.length > 0, 'Alsdorf has a conflict');
  assert.ok(byOid[127].conflicts.some((c) => /7th Street/.test(c)), "Cooley's address conflict");
  assert.equal(byOid[162].source, 'fwc-inventory');
  assert.ok(byOid[162].notes.includes('no official page checked'));
});

test('Miami-Dade ramps present and filtered', () => {
  const md = ramps.filter((r) => r.county === 'MIAMI-DADE');
  assert.equal(md.length, 11);
  for (const r of md) {
    assert.equal(r.source, 'fwc-inventory');
    assert.ok(r.lat > 25.30 && r.lat < 26.0, r.name);
    assert.equal(r.fwc.WaterType, 'Salt or Brackish Water');
  }
  for (const oid of [1349, 1332, 1370]) assert.ok(!ramps.some((r) => r.fwc.OBJECTID === oid), `excluded ${oid}`);
  assert.equal(ramps.find((r) => r.fwc.OBJECTID === 1344).status, 'closed'); // Legion Park
});
