// Rule evaluation: active regime, next change, strictest-wins at a point.
import { localParts, zonedToDate, addDays, DEFAULT_TZ } from './time.js';
import { matchesWhen, hhmmToMinutes } from './schedule.js';
import { pointInGeometry, geometryBBox, bboxContains, distanceToGeometryM, expandBBox } from './geo.js';

const MAX_DAYS = 400;

/** First matching regime, or null (no restriction now). parts from localParts(). */
export function activeRegime(zone, parts) {
  const regimes = zone.regimes || [];
  for (let i = 0; i < regimes.length; i++) {
    const g = regimes[i];
    if (matchesWhen(g.when, parts)) return { restriction: g.restriction, label: g.label, regimeIndex: i };
  }
  return null;
}

const restrictionKey = (a) => (a ? `${a.restriction.kind}|${a.restriction.mph ?? ''}|${a.restriction.label}` : 'none');

/** Local minutes-of-day at which this zone's regimes may change (besides midnight). */
function edgeMinutes(zone) {
  const set = new Set();
  for (const g of zone.regimes || []) {
    if (g.when && g.when.time) {
      set.add(hhmmToMinutes(g.when.time.start) % 1440);
      set.add(hhmmToMinutes(g.when.time.end) % 1440);
    }
  }
  set.delete(0);
  return [...set].sort((a, b) => a - b);
}

/**
 * Next instant after `date` at which the effective restriction differs.
 * Returns {at, restriction|null, label} or null if nothing changes within 400 days.
 */
export function nextChange(zone, date, tz = DEFAULT_TZ) {
  const start = localParts(date, tz);
  const cur = restrictionKey(activeRegime(zone, start));
  if ((zone.regimes || []).every((g) => !g.when)) return null; // static zone never changes
  const edges = [0, ...edgeMinutes(zone)];
  const t0 = date.getTime();
  for (let d = 0; d <= MAX_DAYS; d++) {
    const day = addDays(start, d);
    for (const m of edges) {
      if (d === 0 && m <= start.minutes) continue;
      // Candidates are evaluated on wall-clock parts (edges are never inside the 02:00 DST gap).
      const parts = { year: day.year, month: day.month, day: day.day, dow: day.dow, hour: Math.floor(m / 60), minute: m % 60, minutes: m };
      const a = activeRegime(zone, parts);
      if (restrictionKey(a) !== cur) {
        const at = zonedToDate(parts, tz);
        if (at.getTime() <= t0) continue;
        return { at, restriction: a ? a.restriction : null, label: a ? a.label : 'No restriction' };
      }
    }
  }
  return null;
}

const SEVERITY = { no_entry: 1000, restricted_entry: 950, motor_prohibited: 900, idle: 800, slow: 700 };

export function severity(restriction) {
  if (!restriction) return 0;
  if (restriction.kind in SEVERITY) return SEVERITY[restriction.kind];
  if (restriction.kind === 'max_mph') return 100 - (Number(restriction.mph) || 0);
  return 0;
}

export function zonesAtPoint(zones, point) {
  return zones.filter((z) => z.geometry && pointInGeometry(point, z.geometry));
}

/**
 * {effective: {restriction, label, zone, regimeIndex} | null, contributions:[{zone, active, next}], warnings:[string]}
 */
export function evaluatePoint(zones, point, date, tz = DEFAULT_TZ) {
  const parts = localParts(date, tz);
  const here = zonesAtPoint(zones, point);
  const warnings = [];
  const contributions = here.map((zone) => ({ zone, active: activeRegime(zone, parts), next: nextChange(zone, date, tz) }));
  let effective = null;
  for (const c of contributions) {
    if (!c.active) continue;
    if (!effective || severity(c.active.restriction) > severity(effective.restriction)) {
      effective = { restriction: c.active.restriction, label: c.active.label, zone: c.zone, regimeIndex: c.active.regimeIndex };
    }
  }
  for (const zone of here) {
    if (zone.status === 'unconfirmed') {
      warnings.push(`"${zone.name}" (${zone.rule}) is unconfirmed — rule status not verified; treated as in force. Obey posted signs.`);
    } else if (zone.status === 'digitized') {
      warnings.push(`"${zone.name}" (${zone.rule}) is hand-digitized, not official GIS — boundary is approximate. Obey posted signs.`);
    }
    for (const w of zone.warnings || []) warnings.push(`${zone.name}: ${w}`);
  }
  for (const c of contributions) {
    if (c.active && c.active.restriction.unknown && !(c.zone.warnings || []).length) {
      warnings.push(`${c.zone.name}: unknown restriction code — treated as Slow Speed; obey posted signs`);
    }
  }
  return { effective, contributions, warnings };
}

/** Zones within `meters` of point (0 if inside), sorted by distance. */
export function nearbyZones(zones, point, meters, filterFn) {
  const out = [];
  for (const zone of zones) {
    if (!zone.geometry) continue;
    if (filterFn && !filterFn(zone)) continue;
    if (!bboxContains(expandBBox(geometryBBox(zone.geometry), meters), point)) continue;
    const distanceM = distanceToGeometryM(point, zone.geometry);
    if (distanceM <= meters) out.push({ zone, distanceM });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}
