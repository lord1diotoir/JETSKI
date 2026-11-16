import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFeature, normalizeAll, activeRegime, nextChange, localParts, zonedToDate, evaluatePoint, severity,
} from '../src/engine/index.js';
import * as F from './engine.fixtures.js';

const at = (y, mo, d, h = 12, mi = 0) => zonedToDate({ year: y, month: mo, day: d, hour: h, minute: mi });
const act = (zone, y, mo, d, h = 12, mi = 0) => activeRegime(zone, localParts(at(y, mo, d, h, mi)));
const kind = (a) => (a ? (a.restriction.kind === 'max_mph' ? `${a.restriction.mph}mph` : a.restriction.kind) : null);

test('Broward SS / 25 MPH seasons (NOV 15 - MAR 31)', () => {
  const z = normalizeFeature(F.browardSS25);
  assert.equal(z.layer, 'manatee');
  assert.equal(z.county, 'BROWARD');
  assert.equal(z.ruleUrl, 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-68C-22-010');
  assert.equal(z.id, 'fwc68c-50');
  assert.equal(kind(act(z, 2026, 3, 31)), 'slow');
  assert.equal(kind(act(z, 2026, 4, 1)), '25mph');
  assert.equal(kind(act(z, 2026, 11, 14)), '25mph');
  assert.equal(kind(act(z, 2026, 11, 15)), 'slow');
  assert.equal(kind(act(z, 2026, 4, 15)), '25mph'); // NOT the Miami-Dade season
  assert.deepEqual(z.warnings, []);
});

test('Miami-Dade SS / 30 MPH seasons (NOV 15 - APR 30)', () => {
  const z = normalizeFeature(F.mdSS30);
  assert.equal(z.county, 'MIAMI-DADE');
  assert.equal(z.ruleUrl, 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-68C-22-025');
  assert.equal(kind(act(z, 2026, 4, 15)), 'slow');
  assert.equal(kind(act(z, 2026, 4, 30)), 'slow');
  assert.equal(kind(act(z, 2026, 5, 1)), '30mph');
  assert.equal(kind(act(z, 2026, 11, 15)), 'slow');
  assert.match(z.name, /Test waters/);
});

test('SS WKND zone (68C-22.010(2)(g))', () => {
  const z = normalizeFeature(F.ssWknd);
  assert.deepEqual(z.warnings, []);
  assert.equal(z.regimes.length, 3);
  assert.equal(kind(act(z, 2026, 11, 21, 10)), 'slow'); // Sat
  assert.equal(kind(act(z, 2026, 11, 21, 6, 59)), '25mph');
  assert.equal(kind(act(z, 2026, 11, 21, 7, 0)), 'slow');
  assert.equal(kind(act(z, 2026, 11, 21, 18, 59)), 'slow');
  assert.equal(kind(act(z, 2026, 11, 21, 19, 0)), '25mph');
  assert.equal(kind(act(z, 2026, 11, 16, 10)), '25mph'); // Mon
  assert.equal(kind(act(z, 2026, 11, 26, 10)), 'slow'); // Thanksgiving
  assert.equal(kind(act(z, 2026, 11, 27, 10)), 'slow'); // Friday after
  assert.equal(kind(act(z, 2026, 11, 11, 10)), '25mph'); // Veterans Day but out of season (Nov 11 < Nov 15)
  assert.equal(kind(act(z, 2026, 4, 4, 10)), '25mph'); // Sat, off season
  assert.equal(kind(act(z, 2026, 3, 8, 7, 30)), 'slow'); // Sun, DST start day
  assert.equal(kind(act(z, 2026, 3, 8, 6, 59)), '25mph');
  assert.equal(kind(act(z, 2027, 1, 18, 10)), 'slow'); // MLK Monday
  assert.equal(kind(act(z, 2026, 12, 25, 10)), 'slow'); // Christmas Friday
});

test('SS WKND: Veterans Day in season would be slow (holiday logic check via synthetic season)', () => {
  const f = structuredClone(F.ssWknd);
  f.properties.DATE1_68C = 'NOV 1 - MAR 31';
  f.properties.DATE2_68C = 'APR 1 - OCT 31';
  const z = normalizeFeature(f);
  assert.equal(kind(act(z, 2026, 11, 11, 10)), 'slow'); // Wed holiday
  assert.equal(kind(act(z, 2026, 11, 12, 10)), '25mph'); // Thu
});

test('nextChange for SS WKND', () => {
  const z = normalizeFeature(F.ssWknd);
  const n1 = nextChange(z, at(2026, 11, 20, 12));
  assert.equal(n1.at.toISOString(), at(2026, 11, 21, 7, 0).toISOString());
  assert.equal(n1.restriction.kind, 'slow');
  const n2 = nextChange(z, at(2026, 11, 21, 12));
  assert.equal(n2.at.toISOString(), at(2026, 11, 21, 19, 0).toISOString());
  assert.equal(n2.restriction.kind, 'max_mph');
  // Off season: next change is at the next weekend/holiday morning after Nov 15 (Sun Nov 15 07:00).
  const n3 = nextChange(z, at(2026, 11, 2, 12));
  assert.equal(n3.at.toISOString(), at(2026, 11, 15, 7, 0).toISOString());
});

test('nextChange seasonal and static', () => {
  const z = normalizeFeature(F.browardSS25);
  const n = nextChange(z, at(2026, 11, 16, 10));
  assert.equal(n.at.toISOString(), at(2027, 4, 1, 0, 0).toISOString());
  assert.equal(n.restriction.mph, 25);
  const idle = normalizeFeature(F.idleBridge);
  assert.equal(nextChange(idle, at(2026, 11, 16, 10)), null);
  const sun = normalizeFeature(F.sunriseSouth);
  const ns = nextChange(sun, at(2026, 11, 17, 10)); // Tue -> Sat 00:00
  assert.equal(ns.at.toISOString(), at(2026, 11, 21, 0, 0).toISOString());
  assert.equal(ns.restriction.kind, 'slow');
  const ns2 = nextChange(sun, at(2026, 11, 21, 10)); // Sat -> Mon 00:00 -> null
  assert.equal(ns2.at.toISOString(), at(2026, 11, 23, 0, 0).toISOString());
  assert.equal(ns2.restriction, null);
});

test('Sunrise Blvd Bridge South conditional', () => {
  const z = normalizeFeature(F.sunriseSouth);
  assert.equal(z.layer, 'bra');
  assert.equal(z.county, 'BROWARD');
  assert.match(z.ruleUrl, /flrules\.org/);
  assert.equal(kind(act(z, 2026, 11, 21, 10)), 'slow'); // Sat
  assert.equal(kind(act(z, 2026, 11, 21, 2)), 'slow'); // all day
  assert.equal(act(z, 2026, 11, 17, 10), null); // Tue
  assert.equal(kind(act(z, 2026, 12, 25, 10)), 'slow'); // Christmas (Fri)
});

test('BRA 30 MPH countywide and digitized mappings', () => {
  const c = normalizeFeature(F.county30);
  const a = act(c, 2026, 11, 16);
  assert.deepEqual([a.restriction.kind, a.restriction.mph, a.restriction.wakeIn, a.restriction.dBA], ['max_mph', 30, 15, 80]);
  assert.equal(normalizeFeature(F.idleBridge).regimes[0].restriction.kind, 'idle');
  const d = normalizeFeature(F.digitizedUscg);
  assert.equal(d.layer, 'uscg');
  assert.equal(d.status, 'digitized');
  assert.equal(d.regimes[0].restriction.kind, 'restricted_entry');
});

test('severity ordering', () => {
  assert.equal(severity({ kind: 'no_entry' }), 1000);
  assert.equal(severity({ kind: 'restricted_entry' }), 950);
  assert.equal(severity({ kind: 'motor_prohibited' }), 900);
  assert.equal(severity({ kind: 'idle' }), 800);
  assert.equal(severity({ kind: 'slow' }), 700);
  assert.equal(severity({ kind: 'max_mph', mph: 25 }), 75);
  assert.ok(severity({ kind: 'max_mph', mph: 25 }) > severity({ kind: 'max_mph', mph: 30 }));
  assert.equal(severity(null), 0);
});

test('manatee code mappings', () => {
  const mk = (c1) => normalizeFeature(F.feat({ ...F.browardSS25.properties, CLASS1_68C: c1, DATE1_68C: 'JAN 1 - DEC 31', CLASS2_68C: c1, DATE2_68C: 'JAN 1 - DEC 31' }, F.square(0, 0)));
  const k = (c) => mk(c).regimes[0].restriction.kind;
  assert.equal(k('NEAY'), 'no_entry');
  assert.equal(k('NE'), 'no_entry');
  assert.equal(k('MPAY'), 'motor_prohibited');
  assert.equal(k('ISAY'), 'idle');
  assert.equal(k('IS'), 'idle');
  assert.equal(k('SSAY'), 'slow');
  assert.equal(mk('35 MPH').regimes[0].restriction.mph, 35);
  assert.equal(mk('SSAY').regimes.length, 1); // duplicate all-year regime collapsed
});

test('strictest wins', () => {
  const zones = normalizeAll([{ type: 'FeatureCollection', features: [F.county30, F.idleBridge] }]);
  const both = evaluatePoint(zones, [-80.145, 26.055], at(2026, 11, 16, 10));
  assert.equal(both.contributions.length, 2);
  assert.equal(both.effective.restriction.kind, 'idle');
  assert.equal(both.effective.zone.id, 'fwc68d-56');
  assert.deepEqual(both.warnings, []);
  const only = evaluatePoint(zones, [-80.05, 26.15], at(2026, 11, 16, 10));
  assert.equal(only.contributions.length, 1);
  assert.equal(only.effective.restriction.kind, 'max_mph');
  assert.equal(only.effective.restriction.mph, 30);
  assert.equal(only.effective.restriction.wakeIn, 15);
  assert.equal(only.effective.restriction.dBA, 80);
  const none = evaluatePoint(zones, [-79.0, 26.15], at(2026, 11, 16, 10));
  assert.equal(none.effective, null);
  assert.equal(none.contributions.length, 0);
});

test('unknown code -> slow + warning', () => {
  const z = normalizeFeature(F.unknownCode);
  assert.equal(z.regimes[0].restriction.kind, 'slow');
  assert.equal(z.regimes[0].restriction.label, 'Unknown code — obey posted signs');
  assert.ok(z.warnings.length >= 1);
  const r = evaluatePoint([z], [-80.295, 26.305], at(2026, 11, 16, 10));
  assert.equal(r.effective.restriction.kind, 'slow');
  assert.ok(r.warnings.some((w) => /Unknown/.test(w)));
});

test('unconfirmed and digitized zones warn but still count', () => {
  const zones = normalizeAll([{ type: 'FeatureCollection', features: [F.unconfirmed, F.digitizedUscg, F.county30] }]);
  const r = evaluatePoint(zones, [-80.115, 25.985], at(2026, 11, 16, 10));
  assert.equal(r.effective.restriction.kind, 'slow');
  assert.equal(r.effective.zone.status, 'unconfirmed');
  assert.ok(r.warnings.some((w) => /unconfirmed/.test(w) && /Hallandale/.test(w)));
  const d = evaluatePoint(zones, [-80.128, 26.082], at(2026, 11, 16, 10));
  assert.equal(d.effective.restriction.kind, 'restricted_entry');
  assert.ok(d.warnings.some((w) => /digitized/.test(w)));
});
