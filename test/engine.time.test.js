import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, zonedToDate, floridaHolidays, isFloridaHoliday, parseDateRange, inSeason, matchesWhen } from '../src/engine/index.js';

test('localParts in America/New_York', () => {
  const p = localParts(new Date('2026-07-04T16:30:00Z'));
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute, p.dow, p.minutes], [2026, 7, 4, 12, 30, 6, 750]);
  const w = localParts(new Date('2026-01-01T04:59:00Z'));
  assert.deepEqual([w.year, w.month, w.day, w.hour, w.minute], [2025, 12, 31, 23, 59]);
  const m = localParts(new Date('2026-03-10T04:00:00Z'));
  assert.equal(m.hour, 0); // midnight EDT renders as 0, not 24
});

test('zonedToDate round-trips across DST (2026-03-08, 2026-11-01)', () => {
  for (const day of [{ year: 2026, month: 3, day: 7 }, { year: 2026, month: 3, day: 8 }, { year: 2026, month: 3, day: 9 },
    { year: 2026, month: 10, day: 31 }, { year: 2026, month: 11, day: 1 }, { year: 2026, month: 11, day: 2 }]) {
    for (let h = 0; h < 24; h++) {
      for (const minute of [0, 30]) {
        if (day.month === 3 && day.day === 8 && h === 2) continue; // nonexistent hour
        const d = zonedToDate({ ...day, hour: h, minute });
        const p = localParts(d);
        assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [day.year, day.month, day.day, h, minute], `${JSON.stringify(day)} ${h}:${minute}`);
      }
    }
  }
  assert.equal(zonedToDate({ year: 2026, month: 3, day: 8, hour: 1, minute: 0 }).toISOString(), '2026-03-08T06:00:00.000Z');
  assert.equal(zonedToDate({ year: 2026, month: 3, day: 8, hour: 3, minute: 0 }).toISOString(), '2026-03-08T07:00:00.000Z');
  // Ambiguous 01:30 on fall-back day resolves to first (EDT) occurrence
  assert.equal(zonedToDate({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(zonedToDate({ year: 2026, month: 11, day: 1, hour: 3, minute: 0 }).toISOString(), '2026-11-01T08:00:00.000Z');
  // Gap time resolves after the gap
  assert.equal(zonedToDate({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }).toISOString(), '2026-03-08T07:30:00.000Z');
});

test('Florida holidays', () => {
  const has = (y, m, d) => isFloridaHoliday({ year: y, month: m, day: d });
  assert.ok(has(2027, 7, 4) && !has(2027, 7, 4).observed);
  assert.deepEqual(has(2027, 7, 5), { name: 'Independence Day (observed)', observed: true });
  assert.equal(has(2027, 7, 3), null);
  assert.ok(has(2022, 1, 1));
  assert.equal(has(2021, 12, 31)?.observed, true);
  assert.ok(floridaHolidays(2021).some((h) => h.date === '2021-12-31' && h.observed));
  assert.ok(!floridaHolidays(2022).some((h) => h.date.startsWith('2021')));
  assert.ok(has(2027, 1, 18) && /King/.test(has(2027, 1, 18).name));
  assert.equal(has(2027, 1, 11), null);
  assert.equal(has(2026, 11, 26).name, 'Thanksgiving Day');
  assert.equal(has(2026, 11, 27).name, 'Friday after Thanksgiving');
  assert.equal(has(2026, 11, 11).name, "Veterans' Day");
  assert.ok(has(2026, 5, 25)); // Memorial Day 2026
  assert.ok(has(2026, 9, 7)); // Labor Day 2026
  assert.ok(has(2026, 12, 25));
  assert.equal(has(2026, 11, 20), null);
});

test('parseDateRange / inSeason', () => {
  assert.deepEqual(parseDateRange('NOV 15 - MAR 31'), { start: [11, 15], end: [3, 31] });
  assert.deepEqual(parseDateRange('APR 1 - NOV 14'), { start: [4, 1], end: [11, 14] });
  assert.deepEqual(parseDateRange('  jan 1 -  dec 31 '), { start: [1, 1], end: [12, 31] });
  assert.deepEqual(parseDateRange('MAY 1 - NOV 14'), { start: [5, 1], end: [11, 14] });
  assert.deepEqual(parseDateRange('Nov 15-Apr 30'), { start: [11, 15], end: [4, 30] });
  assert.equal(parseDateRange('garbage'), null);
  const w = parseDateRange('NOV 15 - MAR 31');
  assert.ok(inSeason(w, { month: 11, day: 15 }));
  assert.ok(inSeason(w, { month: 1, day: 10 }));
  assert.ok(inSeason(w, { month: 3, day: 31 }));
  assert.ok(!inSeason(w, { month: 4, day: 1 }));
  assert.ok(!inSeason(w, { month: 11, day: 14 }));
});

test('matchesWhen time window: start inclusive, end exclusive', () => {
  const when = { days: 'all', time: { start: '07:00', end: '19:00' } };
  const at = (minutes) => matchesWhen(when, { year: 2026, month: 6, day: 1, dow: 1, minutes });
  assert.ok(!at(419));
  assert.ok(at(420));
  assert.ok(at(1139));
  assert.ok(!at(1140));
  const wh = { days: 'weekday_nonholiday' };
  assert.ok(matchesWhen(wh, { year: 2026, month: 11, day: 16, dow: 1, minutes: 600 }));
  assert.ok(!matchesWhen(wh, { year: 2026, month: 11, day: 26, dow: 4, minutes: 600 }));
});
