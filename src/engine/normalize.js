// GeoJSON feature -> Zone. See SPEC.md "Required rule mappings".
import { parseDateRange, isAllYear, describeWhen } from './schedule.js';

const URL_68C_BROWARD = 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-68C-22-010';
const URL_68C_MIAMIDADE = 'https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-68C-22-025';
export const UNKNOWN_LABEL = 'Unknown code — obey posted signs';

export const R = {
  noEntry: () => ({ kind: 'no_entry', label: 'No Entry' }),
  restrictedEntry: () => ({ kind: 'restricted_entry', label: 'No Entry Without COTP Permission' }),
  motorProhibited: () => ({ kind: 'motor_prohibited', label: 'Motorboats Prohibited' }),
  idle: () => ({ kind: 'idle', label: 'Idle Speed No Wake' }),
  slow: () => ({ kind: 'slow', label: 'Slow Speed Minimum Wake' }),
  maxMph: (mph, extra = {}) => {
    const r = { kind: 'max_mph', mph, ...extra, label: `Max ${mph} MPH` };
    if (extra.wakeIn) r.label += ` / Max Wake ${extra.wakeIn} in`;
    if (extra.dBA) r.label += ` / Max Sound ${extra.dBA} dBA`;
    return r;
  },
  unknown: () => ({ kind: 'slow', label: UNKNOWN_LABEL, unknown: true }),
};

/** FWC 68C CLASS code -> restriction (unknown codes fail safe to slow, flagged `unknown:true`). */
export function restrictionFromCode(code) {
  const c = String(code ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  switch (c) {
    case 'NEAY': case 'NE': return R.noEntry();
    case 'MPAY': case 'MP': return R.motorProhibited();
    case 'ISAY': case 'IS': return R.idle();
    case 'SSAY': case 'SS': case 'SS WKND': return R.slow();
  }
  const mph = c.match(/^(\d{1,2})\s*MPH$/);
  if (mph) return R.maxMph(Number(mph[1]));
  return R.unknown();
}

const sameRestriction = (a, b) => a && b && a.kind === b.kind && a.mph === b.mph && a.label === b.label;

function regime(restriction, when) {
  const w = when && Object.keys(when).length ? when : null;
  return { restriction, when: w, label: w ? `${restriction.label} (${describeWhen(w)})` : `${restriction.label} (At all times)` };
}

function seasonWhen(dateStr, warnings, field) {
  const range = parseDateRange(dateStr);
  if (!range) {
    if (dateStr != null && String(dateStr).trim()) warnings.push(`Unparseable ${field} "${dateStr}" — treated as all year`);
    return {};
  }
  return isAllYear(range) ? {} : { season: range };
}

const clean = (s) => (s == null ? '' : String(s).trim());

function normalizeManatee(f) {
  const p = f.properties || {};
  const warnings = [];
  const county = clean(p.COUNTY).toUpperCase() || 'UNKNOWN';
  const code1 = clean(p.CLASS1_68C), code2 = clean(p.CLASS2_68C);
  const r1 = restrictionFromCode(code1);
  const r2 = code2 ? restrictionFromCode(code2) : null;
  const regimes = [];
  const isWknd = code1.toUpperCase().replace(/\s+/g, ' ') === 'SS WKND';
  if (isWknd) {
    regimes.push(regime(r1, { ...seasonWhen(p.DATE1_68C, warnings, 'DATE1_68C'), days: 'weekend_holiday', time: { start: '07:00', end: '19:00' } }));
  } else {
    regimes.push(regime(r1, seasonWhen(p.DATE1_68C, warnings, 'DATE1_68C')));
  }
  if (r2) {
    const w2 = seasonWhen(p.DATE2_68C, warnings, 'DATE2_68C');
    const dup = regimes.some((g) => sameRestriction(g.restriction, r2) && !g.when && !Object.keys(w2).length);
    if (!dup) regimes.push(regime(r2, w2));
    if (isWknd) regimes.push(regime(r2, {}));
  } else if (isWknd) {
    regimes.push(regime(R.unknown(), {}));
    warnings.push(`Zone with code "SS WKND" has no CLASS2 restriction — obey posted signs`);
  }
  for (const [code, r] of [[code1, r1], [code2, r2]]) {
    if (r && r.unknown) warnings.push(`Unknown manatee zone code "${code}" — treated as Slow Speed; obey posted signs`);
  }
  const text = clean(p.TEXT_68C), notes = clean(p.NOTES_68C), sect = clean(p.SECT_68C);
  const isMD = county.includes('DADE');
  return {
    id: p._id || `fwc68c-${p.OBJECTID}`,
    layer: 'manatee',
    county,
    name: [text || 'Manatee protection zone', notes || sect].filter(Boolean).join(' — '),
    rule: sect || (isMD ? '68C-22.025' : '68C-22.010'),
    ruleUrl: isMD ? URL_68C_MIAMIDADE : URL_68C_BROWARD,
    status: p._status || 'gis',
    regimes,
    notes: notes || null,
    warnings,
    geometry: f.geometry,
    sourceProps: p,
  };
}

/** BRA RESTRICTION text / digitized restriction text -> {restriction, conditional} */
export function restrictionFromText(text) {
  const t = clean(text).toLowerCase();
  if (!t) return null;
  if (t.includes('cotp') || t.startsWith('no entry without')) return R.restrictedEntry();
  if (t.startsWith('no entry')) return R.noEntry();
  if (t.includes('motorboats prohibited') || t.includes('motorboat prohibited')) return R.motorProhibited();
  if (t.startsWith('idle speed')) return R.idle();
  if (t.startsWith('slow speed')) return R.slow();
  const mph = t.match(/max(?:imum)?\s*speed\s*(\d{1,2})\s*mph/) || t.match(/^(\d{1,2})\s*mph/);
  if (mph) {
    const extra = {};
    const wake = t.match(/wake\s*(\d{1,3})\s*inch/);
    const db = t.match(/sound\s*(\d{2,3})\s*dba/);
    if (wake) extra.wakeIn = Number(wake[1]);
    if (db) extra.dBA = Number(db[1]);
    return R.maxMph(Number(mph[1]), extra);
  }
  return null;
}

function scheduleWhen(sched, conditional, warnings) {
  const s = clean(sched).toLowerCase();
  if (!conditional && (!s || s.startsWith('at all times') || s.startsWith('except where superseded') || s === 'all year')) return {};
  if (/saturday|sunday|weekend|holiday/.test(s)) return { days: 'weekend_holiday' };
  if (!s || s.startsWith('at all times')) return {};
  warnings.push(`Unrecognized condition "${sched}" — treated as at all times; obey posted signs`);
  return {};
}

function normalizeBra(f) {
  const p = f.properties || {};
  const warnings = [];
  const restrictionText = clean(p.RESTRICTION);
  const conditional = /conditional/i.test(restrictionText);
  let r = restrictionFromText(restrictionText);
  if (!r) {
    r = R.unknown();
    warnings.push(`Unknown restriction "${restrictionText}" — treated as Slow Speed; obey posted signs`);
  }
  const when = scheduleWhen(p.CON_SHORT, conditional, warnings);
  return {
    id: p._id || `fwc68d-${p.OBJECTID}`,
    layer: 'bra',
    county: clean(p.COUNTY).toUpperCase() || 'BROWARD',
    name: clean(p.AREA_NAME) || clean(p.AREA_NUM) || 'Boating restricted area',
    rule: clean(p.AREA_NUM) || '68D-24.008',
    ruleUrl: clean(p.HYPERLINK) || 'https://www.flrules.org/gateway/RuleNo.asp?id=68D-24.008',
    status: p._status || 'gis',
    regimes: [regime(r, when)],
    notes: clean(p.NOTES) || null,
    warnings,
    geometry: f.geometry,
    sourceProps: p,
  };
}

function normalizeDigitized(f) {
  const p = f.properties || {};
  const warnings = [];
  let r = restrictionFromText(p.restriction);
  if (!r) {
    r = R.unknown();
    warnings.push(`Unknown restriction "${p.restriction}" — treated as Slow Speed; obey posted signs`);
  }
  const when = scheduleWhen(p.schedule, false, warnings);
  const layer = p._layer || 'uscg';
  return {
    id: p._id,
    layer,
    county: clean(p.county || p.COUNTY).toUpperCase() || 'BROWARD',
    name: clean(p.name) || p._id,
    rule: clean(p.rule),
    ruleUrl: clean(p.ruleUrl),
    status: p._status || 'digitized',
    regimes: [regime(r, when)],
    notes: clean(p.notes) || null,
    warnings,
    geometry: f.geometry,
    sourceProps: p,
  };
}

export function normalizeFeature(feature) {
  const p = feature.properties || {};
  if (p._status === 'digitized' || ('restriction' in p && 'name' in p && !('RESTRICTION' in p))) return normalizeDigitized(feature);
  if ('CLASS1_68C' in p || p._layer === 'manatee') return normalizeManatee(feature);
  if ('RESTRICTION' in p || p._layer === 'bra') return normalizeBra(feature);
  return normalizeDigitized(feature);
}

export function normalizeAll(featureCollections) {
  const out = [];
  for (const fc of featureCollections || []) {
    if (!fc) continue;
    const feats = fc.type === 'FeatureCollection' ? fc.features : Array.isArray(fc) ? fc : [fc];
    for (const f of feats) if (f && f.geometry) out.push(normalizeFeature(f));
  }
  return out;
}
