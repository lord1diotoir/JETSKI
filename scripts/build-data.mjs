#!/usr/bin/env node
// Build public/data/* from data/raw/* (see SPEC.md "Data contract").
// Deterministic and offline by default. `--refresh` re-downloads the FWC layers into data/raw first.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bboxClip from '@turf/bbox-clip';
import area from '@turf/area';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'public', 'data');
const FETCHED = '2026-11-16';
export const CLIP_BBOX = [-80.55, 25.30, -80.05, 26.35]; // [minLon, minLat, maxLon, maxLat]

const FWC = {
  manatee_broward: 'https://gis.myfwc.com/hosting/rest/services/Open_Data/State_Manatee_Protection_Zones_in_Florida/MapServer/9/query?where=COUNTY%3D%27BROWARD%27&outFields=*&outSR=4326&f=geojson',
  manatee_md: 'https://gis.myfwc.com/hosting/rest/services/Open_Data/State_Manatee_Protection_Zones_in_Florida/MapServer/9/query?where=COUNTY%3D%27MIAMI-DADE%27&outFields=*&outSR=4326&f=geojson',
  bra_broward: 'https://gis.myfwc.com/hosting/rest/services/Open_Data/State_Boating_Safety_Zones_Florida/MapServer/10/query?where=RULE_NUM%3D%2768D-24.008%27&outFields=*&outSR=4326&f=geojson',
  ramps_broward: 'https://gis.myfwc.com/mapping/rest/services/Open_Data/FWC_Florida_Boat_Ramp_Inventory/MapServer/4/query?where=County%3D%27BROWARD%27&outFields=*&outSR=4326&f=geojson',
  ramps_md: 'https://gis.myfwc.com/mapping/rest/services/Open_Data/FWC_Florida_Boat_Ramp_Inventory/MapServer/4/query?where=County%3D%27MIAMI-DADE%27&outFields=*&outSR=4326&f=geojson',
};
const ECFR = {
  '165.760': 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-P/part-165/subpart-F/subject-group-ECFR29926ffa6ceac0d/section-165.760',
  '165.765': 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-P/part-165/subpart-F/subject-group-ECFR29926ffa6ceac0d/section-165.765',
  '165.711': 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-P/part-165/subpart-F/subject-group-ECFR29926ffa6ceac0d/section-165.711',
};
const RULE_68D_URL = 'https://www.flrules.org/gateway/RuleNo.asp?title=BOATING%20RESTRICTED%20AREAS&ID=68D-24.008';
const NOTICE_URL = 'https://flrules.org/Gateway/View_notice.asp?id=30326291';

// ---------- helpers ----------
const r6 = (x) => Math.round(x * 1e6) / 1e6;
function roundCoords(c) { return typeof c[0] === 'number' ? c.map(r6) : c.map(roundCoords); }
function roundGeom(g) { return { type: g.type, coordinates: roundCoords(g.coordinates) }; }
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
const bboxOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function countPositions(c) { return typeof c[0] === 'number' ? 1 : c.reduce((n, x) => n + countPositions(x), 0); }
/** True if the geometry actually intersects the bbox (clip is non-empty), not only its envelope. */
function intersectsBbox(geom, bbox = CLIP_BBOX) {
  if (!bboxOverlap(geomBbox(geom), bbox)) return false;
  if (geom.type === 'Point') return true;
  const clipped = bboxClip({ type: 'Feature', properties: {}, geometry: geom }, bbox);
  return countPositions(clipped.geometry.coordinates) > 0 && area(clipped) > 0;
}
/** Degrees-minutes-seconds -> decimal degrees. Pass negative=true for W/S. */
function dms(d, m, s = 0, negative = false) { const v = d + m / 60 + s / 3600; return r6(negative ? -v : v); }
const W = (d, m, s = 0) => dms(d, m, s, true);
const N = (d, m, s = 0) => dms(d, m, s, false);
function closeRing(ring) {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}
const readJSON = (f) => JSON.parse(readFileSync(join(RAW, f), 'utf8'));
function writeJSON(name, obj) {
  writeFileSync(join(OUT, name), JSON.stringify(obj, null, 1) + '\n');
}

// ---------- optional refresh ----------
if (process.argv.includes('--refresh')) {
  for (const [name, url] of Object.entries(FWC)) {
    const dest = join(RAW, `${name}.geojson`);
    const tmp = dest + '.tmp';
    console.log(`refresh ${name} <- ${url}`);
    execFileSync('curl', ['-sS', '--fail', '--compressed', '-o', tmp, url], { stdio: 'inherit' });
    const j = JSON.parse(readFileSync(tmp, 'utf8'));
    if (!Array.isArray(j.features) || j.features.length === 0) throw new Error(`refresh ${name}: no features`);
    renameSync(tmp, dest);
    console.log(`  ${j.features.length} features`);
  }
  {
    const url = 'https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer/197/query?where=1%3D1&geometry=-80.13,26.055,-80.105,26.106&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=4326&f=geojson';
    const dest = join(RAW, 'noaa_enc_resare_port_everglades.geojson'), tmp = dest + '.tmp';
    console.log(`refresh NOAA ENC RESARE <- ${url}`);
    execFileSync('curl', ['-sS', '--fail', '--compressed', '-o', tmp, url], { stdio: 'inherit' });
    if (!(JSON.parse(readFileSync(tmp, 'utf8')).features || []).length) throw new Error('refresh NOAA: no features');
    renameSync(tmp, dest);
  }
  console.warn('NOTE: --refresh changes the inputs; metadata.fetched still says ' + FETCHED + ' — update FETCHED if you keep the new snapshot.');
}

mkdirSync(OUT, { recursive: true });
const byId = (a, b) => a.properties.OBJECTID - b.properties.OBJECTID;

// ---------- 1. manatee ----------
const MANATEE_KEEP = ['OBJECTID', 'CLASS1_68C', 'DATE1_68C', 'CLASS2_68C', 'DATE2_68C', 'SECT_68C', 'TEXT_68C', 'NOTES_68C', 'COUNTY', 'last_edited_date'];
const manateeRaw = [...readJSON('manatee_broward.geojson').features, ...readJSON('manatee_md.geojson').features];
const manateeFeatures = manateeRaw
  .filter((f) => intersectsBbox(f.geometry))
  .sort(byId)
  .map((f) => {
    // Keep all original properties (SPEC lists the required ones; extras like MASTER_CL are retained too).
    const p = { ...f.properties };
    for (const k of MANATEE_KEEP) if (!(k in p)) p[k] = null;
    return {
      type: 'Feature',
      properties: { ...p, _layer: 'manatee', _id: `fwc68c-${p.OBJECTID}`, _status: 'gis' },
      geometry: roundGeom(f.geometry),
    };
  });
const manateeCounts = manateeFeatures.reduce((m, f) => ((m[f.properties.COUNTY] = (m[f.properties.COUNTY] || 0) + 1), m), {});
writeJSON('manatee.geojson', {
  type: 'FeatureCollection',
  metadata: {
    source: 'FWC State Manatee Protection Zones in Florida (MapServer layer 9), Rule 68C-22 F.A.C.',
    url: [FWC.manatee_broward, FWC.manatee_md],
    fetched: FETCHED,
    count: manateeFeatures.length,
    countByCounty: manateeCounts,
    rawCount: manateeRaw.length,
    notes: `Broward + Miami-Dade features intersecting bbox ${CLIP_BBOX.join(',')}; geometry not clipped, coordinates rounded to 6 decimals. ` +
      'Seasons come from each feature\'s DATE1_68C/DATE2_68C (Broward NOV 15 - MAR 31 / APR 1 - NOV 14; Miami-Dade NOV 15 - APR 30 / MAY 1 - NOV 14). ' +
      'Posted signs prevail; FAC prevails over GIS (68C-22.010(5)).',
  },
  features: manateeFeatures,
});

// ---------- 2. bra ----------
const BRA_KEEP = ['OBJECTID', 'RULE_NUM', 'AREA_NUM', 'AREA_NAME', 'RESTRICTION', 'CON_SHORT', 'CON_LON', 'DATE_IMP', 'NOTES', 'HYPERLINK', 'last_edited_date'];
const braRaw = readJSON('bra_broward.geojson').features;
const braFeatures = braRaw
  .filter((f) => intersectsBbox(f.geometry))
  .sort(byId)
  .map((f) => {
    const p = {};
    for (const k of BRA_KEEP) p[k] = f.properties[k] ?? null;
    if (typeof p.NOTES === 'string' && p.NOTES.trim() === '') p.NOTES = null;
    const is14c = p.OBJECTID === 152;
    return {
      type: 'Feature',
      properties: {
        ...p,
        _layer: 'bra',
        _id: `fwc68d-${p.OBJECTID}`,
        _status: 'gis',
        ...(is14c ? { _statusNote: 'Confirmed in force: FAC 68D-24.008(1)(a)14.c. (rule history "Amended ... 9-27-21"; text in data/raw/fac_68D-24.008_eff-2026-02-03.txt) — Slow Speed Minimum Wake from 400 ft south of the Hallandale Beach Blvd Bridge to the Dade/Broward line. The GIS NOTES ("To be voted on by Commission 8/5/2021") and blank DATE_IMP are stale.' } : {}),
      },
      geometry: roundGeom(f.geometry),
    };
  });
writeJSON('bra.geojson', {
  type: 'FeatureCollection',
  metadata: {
    source: 'FWC State Boating Safety Zones Florida (MapServer layer 10), Rule 68D-24.008 F.A.C. (Broward County)',
    url: FWC.bra_broward,
    fetched: FETCHED,
    count: braFeatures.length,
    notes: 'OBJECTID 152 (68D-24.008(1)(a)14.c.) confirmed in force against the FAC text (amended 9-27-21) despite its stale GIS note. The Lauderdale Beach ICW Zone (amended eff. 2026-02-03) is NOT in this layer — see digitized.geojson. ' +
      'Coordinates rounded to 6 decimals. Posted signs prevail; FAC prevails over GIS.',
  },
  features: braFeatures,
});

// ---------- 3. digitized ----------
const xml760 = readFileSync(join(RAW, 'ecfr_165.760.xml'), 'utf8');
const xml765 = readFileSync(join(RAW, 'ecfr_165.765.xml'), 'utf8');
const xml711 = readFileSync(join(RAW, 'ecfr_165.711.xml'), 'utf8');
// Guard: the coordinates hard-coded below must still be present verbatim in the eCFR snapshots.
const mustContain = (xml, label, strs) => {
  const text = xml.replace(/<[^>]*>/g, ' ');
  for (const s of strs) if (!text.includes(s)) throw new Error(`eCFR ${label} no longer contains "${s}" — re-digitize`);
};
mustContain(xml760, '165.760', ['26°05′24″ N, 080°06′57″ W', '26°06′01″ N, 080°07′09″ W', '26°06′01″ N, 080°07′10″ W',
  '26°05′25″ N, 080°06′58″ W', '26°05′25″ N, 080°06′54″ W', '26°05′10″ N, 080°06′49″ W', '26°04′43″ N, 080°06′53″ W',
  '26°03′54″ N, 080°06′52″ W', '26°03′54″ N, 080°06′55″ W', '26°05′30″ N, 080°04′46″ W', '100 yards']);
mustContain(xml765, '165.765', ['26°05.687′ N, 080°06.684′ W', '26°05.552′ N, 080°06.682′ W', '26°05.482′ N, 080°06.793′ W', '26°05.666′ N, 080°06.947′ W', '150 meters']);
mustContain(xml711, '165.711', ['26°05.5′ N, 80°04.8′ W', '26°04.9′ N, 80°06.9′ W', '700 yards forward, 500 yards astern and 350 yards']);

// (a)-(c) USCG zones from NOAA's harbour-scale ENC (cells US5PEFBA / US5PEFCA), layer Restricted_Area_area
// (S-57 RESARE), snapshot data/raw/noaa_enc_resare_port_everglades.geojson. NOAA charts the 165.760 fixed security zone
// to the real pier faces and shorelines (land cut out as holes) and the 165.765 RNA shore to shore.
// Guard: every coordinate the CFR gives must lie on or next to NOAA's boundary.
const encRaw = readJSON('noaa_enc_resare_port_everglades.geojson').features;
const encById = Object.fromEntries(encRaw.map((f) => [f.properties.OBJECTID, f]));
for (const id of [78199, 78202, 78200]) if (!encById[id]) throw new Error(`NOAA ENC RESARE ${id} missing`);
const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
const KX = 111320 * Math.cos((26.09 * Math.PI) / 180), KY = 110574;
function distToRingsM([px, py], rings) {
  let best = Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const [ax, ay] = [r[i - 1][0] * KX, r[i - 1][1] * KY], [bx, by] = [r[i][0] * KX, r[i][1] * KY];
    const [x, y] = [px * KX, py * KY], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
const fixedGeom = {
  type: 'MultiPolygon',
  coordinates: [encById[78199].geometry.coordinates, encById[78202].geometry.coordinates],
};
const rnaGeom = encById[78200].geometry;
const CFR_760_POINTS = [
  [W(80, 6, 57), N(26, 5, 24)], [W(80, 7, 9), N(26, 6, 1)], [W(80, 7, 10), N(26, 6, 1)],
  [W(80, 6, 58), N(26, 5, 25)], [W(80, 6, 54), N(26, 5, 25)], [W(80, 6, 49), N(26, 5, 10)],
  [W(80, 6, 53), N(26, 4, 43)], [W(80, 6, 52), N(26, 3, 54)], [W(80, 6, 55), N(26, 3, 54)],
];
const CFR_765_POINTS = [[W(80, 6.684), N(26, 5.687)], [W(80, 6.682), N(26, 5.552)], [W(80, 6.793), N(26, 5.482)], [W(80, 6.947), N(26, 5.666)]];
const maxOff = (pts, g) => Math.max(...pts.map((p) => distToRingsM(p, ringsOf(g))));
const off760 = maxOff(CFR_760_POINTS, fixedGeom), off765 = maxOff(CFR_765_POINTS, rnaGeom);
if (off760 > 30 || off765 > 30) throw new Error(`NOAA ENC polygons disagree with CFR points (${off760.toFixed(1)} m / ${off765.toFixed(1)} m)`);

// (d) 68D-24.008 Lauderdale Beach ICW Zone — clip the countywide (1)(b) ICW polygon to a lat band.
const FT_PER_DEG_LAT = 364000;
const braById = Object.fromEntries(braRaw.map((f) => [f.properties.OBJECTID, f]));
// Per FAC 68D-24.008 (eff. 2026-02-03): (a)6. Oakland Park idle zone extends 1,500 ft N and S of the bridge, so its GIS
// south edge (OBJECTID 51) IS the line "1,500 ft south of the Oakland Park Blvd Bridge". (a)7.a. Sunrise idle zone runs
// from 2,250 ft north of the Sunrise bridge to 1,500 ft south, so its GIS north edge (OBJECTID 52) IS the line
// "2,250 ft north of the Sunrise Blvd Bridge". Zone 15 therefore fills exactly the gap between the two idle zones.
const bOak = geomBbox(braById[51].geometry);
const bSunN = geomBbox(braById[52].geometry);
const oaklandBridgeLat = (bOak[1] + bOak[3]) / 2;
const sunriseBridgeLat = bSunN[3] - 2250 / FT_PER_DEG_LAT;   // derived, for the method note only
const lbSouth = bSunN[3];   // 2,250 ft north of Sunrise Blvd Bridge = north edge of the (a)7.a. idle zone
const lbNorth = bOak[1];    // 1,500 ft south of Oakland Park Blvd Bridge = south edge of the (a)6. idle zone
const ICW_LON = [-80.112, -80.100];
const lbClip = bboxClip(braById[144], [ICW_LON[0], lbSouth, ICW_LON[1], lbNorth]);
// Drop empty parts produced by the clipper.
let lbGeom = lbClip.geometry;
if (lbGeom.type === 'MultiPolygon') {
  const parts = lbGeom.coordinates.map((p) => p.filter((r) => r.length >= 4)).filter((p) => p.length);
  lbGeom = parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts };
}
lbGeom = roundGeom(lbGeom);
if (countPositions(lbGeom.coordinates) < 4) throw new Error('Lauderdale Beach clip is empty');
const lbArea = area({ type: 'Feature', properties: {}, geometry: lbGeom });
// ICW here is ~100-200 m wide over ~2.6 km -> expect very roughly 0.2-0.8 km².
if (lbArea < 1e5 || lbArea > 2e6) throw new Error(`Lauderdale Beach clip area implausible: ${lbArea}`);

const COTP = 'Captain of the Port Miami (305-535-4472, VHF 16)';
const digitized = [
  {
    props: {
      _layer: 'uscg', _id: 'uscg-760-fixed', _status: 'gis', name: 'Port Everglades Fixed Security Zones',
      rule: '33 CFR 165.760(b)(3)', ruleUrl: ECFR['165.760'],
      restriction: 'No Entry Without COTP Permission', schedule: 'At All Times',
      notes: `Two fixed security zones: (1) Mid-Port to North-Port, all waters west of the line from the northern tip of Berth 22 to the west side of the 17th Street Bridge; (2) waters west of the Intracoastal Waterway to the pier face, from Mid-Port south to the Dania Cut-Off Canal. Transit on the ICW itself is allowed; entry requires permission of the ${COTP}. If a large vessel encroaches into the ICW, pass east of the on-scene law enforcement vessel.`,
      method: `Geometry from NOAA ENC (US5PEFBA/US5PEFCA, RESARE OBJECTID 78199 + 78202, "Port Everglades Fixed Security Zone", source date 2019-07-12) via encdirect.noaa.gov, fetched ${FETCHED}. Checked: all 9 coordinates in 33 CFR 165.760(b)(3) lie within ${off760.toFixed(0)} m of NOAA's boundary.`,
      source: 'NOAA ENC',
    },
    geometry: fixedGeom,
  },
  {
    props: {
      _layer: 'uscg', _id: 'uscg-765-rna', _status: 'gis', name: 'Port Everglades Harbor Regulated Navigation Area',
      rule: '33 CFR 165.765', ruleUrl: ECFR['165.765'],
      restriction: 'Slow Speed', schedule: 'At All Times',
      notes: 'Vessels less than 150 m entering and transiting shall proceed at slow speed (fully off plane, settled, no excessive wake). State/local manatee zones still apply.',
      method: `Geometry from NOAA ENC (US5PEFBA, RESARE OBJECTID 78200, "no wake area", 33 CFR 165.765) via encdirect.noaa.gov, fetched ${FETCHED}. Checked: the 4 CFR vertices lie within ${off765.toFixed(0)} m of NOAA's boundary.`,
      source: 'NOAA ENC',
    },
    geometry: rnaGeom,
  },
  {
    props: {
      _layer: 'bra', _id: 'fwc68d-lauderdale-beach-icw', name: 'Lauderdale Beach ICW Zone',
      rule: '68D-24.008(1)(a)15. F.A.C. (effective 2026-02-03)', ruleUrl: RULE_68D_URL,
      restriction: 'Slow Speed Minimum Wake', schedule: 'At All Times',
      notes: 'Year-round Slow Speed Minimum Wake, shoreline to shoreline, from 1,500 ft south of the Oakland Park Blvd Bridge to 2,250 ft north of the Sunrise Blvd Bridge. ' +
        'Rule text verified against FAC 68D-24.008(1)(a)15. (history "Amended ... 2-3-26"; FAR notice ' + NOTICE_URL + '). Missing from the FWC GIS layer (last edited 2025-06-03), so the polygon is hand-digitized and FWC drawing L was not available. ' +
        'Boundaries are perpendicular lines across the ICW; this polygon uses the adjoining GIS idle-zone edges, which the rule defines with the same distances. Not survey grade.',
      method: `Clipped the countywide 68D-24.008(1)(b) ICW polygon (FWC OBJECTID 144) to lon ${ICW_LON.join('..')} and lat ${r6(lbSouth)}..${r6(lbNorth)}. ` +
        `North edge = south edge of GIS OBJECTID 51 (Oakland Park idle zone, ±1,500 ft; bridge ≈ ${r6(oaklandBridgeLat)}); south edge = north edge of GIS OBJECTID 52 (Sunrise idle zone, 2,250 ft N of bridge ≈ ${r6(sunriseBridgeLat)}). ` +
        `Offsets at 1° lat ≈ ${FT_PER_DEG_LAT} ft. Not survey grade.`,
    },
    geometry: lbGeom,
  },
];
const digitizedFeatures = digitized.map(({ props, geometry }) => ({
  type: 'Feature',
  properties: { _layer: props._layer, _id: props._id, _status: 'digitized', ...props },
  geometry: roundGeom(geometry),
}));
writeJSON('digitized.geojson', {
  type: 'FeatureCollection',
  metadata: {
    source: 'Hand-digitized from eCFR 33 CFR 165.760 / 165.765 (snapshots 2026-11-16) and the 68D-24.008 amendment notice summary',
    url: [ECFR['165.760'], ECFR['165.765'], NOTICE_URL],
    fetched: FETCHED,
    count: digitizedFeatures.length,
    notes: 'Approximate — not survey grade. See each feature\'s `method`. Palm Beach context polygons intentionally omitted.',
  },
  features: digitizedFeatures,
});

// ---------- 4. uscg_points ----------
const buoyPE = [W(80, 4, 46), N(26, 5, 30)];
const uscgPoints = {
  metadata: {
    source: '33 CFR 165.760, 165.711 and 334.580 (eCFR, current as of 2026-11-16)',
    url: [ECFR['165.760'], ECFR['165.711']],
    fetched: FETCHED,
    notes: 'Moving zones cannot be mapped statically; the app shows them as descriptions plus an alert when the user is in portEvergladesAlertArea. Coordinates NAD83 (≈ WGS84), [lon, lat].',
  },
  buoyPE,
  buoyPEName: 'Port Everglades Lighted Buoy PE (approx. 26°05′30″N 080°04′46″W)',
  carrierMooring: [W(80, 6.9), N(26, 4.9)],
  seaBuoy: [W(80, 4.8), N(26, 5.5)],
  cotpPhone: '305-535-4472',
  vhf: 16,
  moving: [
    {
      id: 'uscg-760-moving', rule: '33 CFR 165.760(b)(1)', ruleUrl: ECFR['165.760'], kind: 'moving',
      radiusYd: 100,
      appliesTo: 'Passenger vessels (>100 ft, >100 GT, >12 passengers, voyages >24 h, not ferries), vessels carrying cargoes of particular hazard, vessels carrying liquefied hazardous gas (LHG)',
      activeWhere: 'Underway westward of Port Everglades Lighted Buoy PE (entering or departing)',
      description: 'Moving security zone 100 yards around passenger (cruise) vessels, vessels carrying cargoes of particular hazard, and LHG vessels while underway west of Buoy PE. Do not enter without COTP Miami permission.',
    },
    {
      id: 'uscg-760-moored', rule: '33 CFR 165.760(b)(1)', ruleUrl: ECFR['165.760'], kind: 'fixed-around-vessel',
      radiusYd: 100,
      appliesTo: 'The same vessel classes while moored in Port Everglades',
      description: 'Fixed security zone 100 yards around such vessels while moored. You may pass within 100 yards of one moored in/alongside a Federal channel only outside the on-scene law enforcement vessel — in Port Everglades pass EAST of the on-scene law enforcement vessel.',
    },
    {
      id: 'uscg-711-carrier', rule: '33 CFR 165.711', ruleUrl: ECFR['165.711'], kind: 'moving',
      aheadYd: 700, asternYd: 500, abeamYd: 350,
      appliesTo: 'Naval aircraft carriers entering or departing Port Everglades',
      activeWhere: 'Between the Port Everglades Sea Buoy (approx. 26°05.5′N 80°04.8′W) and the pier (approx. 26°04.9′N 80°06.9′W)',
      description: 'Moving safety zone 700 yards ahead, 500 yards astern and 350 yards on each side of a naval aircraft carrier entering or departing Port Everglades. No entry without COTP Miami authorization; follow on-scene patrol instructions (VHF 16).',
    },
    {
      id: 'usace-334-580', rule: '33 CFR 334.580', ruleUrl: 'https://www.ecfr.gov/current/title-33/chapter-II/part-334/section-334.580', kind: 'area-note',
      activeWhere: 'Off Port Everglades and Dania Beach: from 26°05′30″N south to 26°01′36″N, between 80°03′30″W and about 80°06′40″W (charted on NOAA ENC as a military area)',
      description: 'Naval Surface Warfare Center restricted area: no anchoring, trawling, dredging or attaching anything to the sea bottom. Passing through is not restricted by this rule.',
    },
  ],
  portEvergladesAlertArea: {
    type: 'Polygon',
    // Port basin + entrance channel out to Buoy PE (east edge just beyond the buoy). Early-warning only, not a legal boundary.
    coordinates: [closeRing([
      [-80.125, 26.060], [-80.079, 26.060], [-80.079, 26.105], [-80.125, 26.105],
    ])],
  },
};
writeJSON('uscg_points.json', uscgPoints);

// ---------- 5. ramps ----------
const rampsRaw = [...readJSON('ramps_broward.geojson').features, ...readJSON('ramps_md.geojson').features];
const rampById = Object.fromEntries(rampsRaw.map((f) => [f.properties.OBJECTID, f]));
const FTL = { url: 'https://www.parks.fortlauderdale.gov/programs/marinas', phone: '954-828-4626' };
const BRIEF = 'per project brief (official page could not be fetched from the build sandbox)';
const CURATED = [
  { oid: 123, name: "Cox's Landing (15th Street Boat Ramp)", address: '1784 SE 15th St', official: { ...FTL, address: '1784 SE 15th St' } },
  { oid: 127, name: "Cooley's Landing", address: '450 SW 7th Ave', official: { ...FTL, address: '450 SW 7th Ave' },
    conflicts: ['Address: FWC inventory says "450 SW 7th Street"; City of Fort Lauderdale says "450 SW 7th Ave" (official used)'] },
  { oid: 180, name: 'George English Park Boat Ramp', address: '1101 Bayview Dr', official: { ...FTL, address: '1101 Bayview Dr' } },
  { oid: 150, name: 'Hollywood Marina — Polk Street Boat Ramps', official: { url: 'https://www.hollywoodfl.org/facilities/facility/details/hollywoodmarina-110' },
    notes: ['FWC inventory: second ramp lane from the east is closed (deteriorated surface).'] },
  { oid: 161, name: 'Holland Park Boat Ramp', address: '801 Johnson St', official: { url: 'https://www.hollywoodfl.org/facilities/facility/details/hollywoodmarina-110', address: '801 Johnson St' } },
  { oid: 154, name: 'Griffin Marine Park Boat Ramp', address: '2987 SW 45th St', fee: 'Free', official: { url: 'https://daniabeachfl.gov/2772/Boat-Ramps', address: '2987 SW 45th St', fee: 'Free' },
    notes: ['Hours 6:00 AM – 8:00 PM per the FWC inventory.'] },
  { oid: 187, name: 'I.T. Parker Boat Ramps at Harbour Towne Marina', official: { url: 'https://daniabeachfl.gov/2772/Boat-Ramps', phone: '954-924-3698' },
    notes: ['Owned by City of Dania Beach, operated by Harbour Towne Marina (FWC inventory). Commercially operated; fee charged.'] },
  { oid: 132, name: 'Alsdorf Park Boat Ramp', address: '2901 NE 14th St', status: 'verify',
    official: { url: 'https://parks.pompanobeachfl.gov/parks/park-map-and-list/alsdorf-park', phone: '954-786-4111', address: '2901 NE 14th St' },
    hours: null, fee: null,
    conflicts: ['Inventory hours/fee differ from the City of Pompano Beach page — call 954-786-4111'],
    notes: ['FWC inventory lists "24 Hours" and $10 fee; not used because the city page differs.'] },
  { oid: 158, name: 'Pioneer Park Boat Ramp', status: 'closed', official: { url: 'https://www.deerfield-beach.com/84/Pioneer-Park', phone: '954-480-4361' },
    notes: ['Temporarily closed for construction (closed ~late Feb 2026; completion anticipated end of Nov 2026 per FWC inventory). Verify with the City of Deerfield Beach before going.'] },
  { oid: 151, name: 'Colohatchee Park Boat Ramp', hours: '24 Hours', fee: 'Free', official: { url: 'https://www.wiltonmanors.com/156/Colohatchee-Boat-Ramp', phone: '954-357-8801', hours: '24 Hours', fee: 'Free' },
    notes: ['Smaller boats; limited parking (FWC inventory).'] },
  { oid: 149, name: 'J. Dewey Hawkins Landing Boat Ramp', hours: '24 Hours', fee: 'Free', official: { url: 'https://oaklandparkfl.gov/218/Parks', phone: '954-630-4500', hours: '24 Hours', fee: 'Free' },
    notes: ['Single lane, ~3 trailer spaces (FWC inventory).'] },
  { oid: 156, name: 'Dr. Von D. Mizell-Eula Johnson State Park Boat Ramp', official: { url: 'https://www.floridastateparks.org/mizell' },
    notes: ['State park entry fee applies.'] },
  { oid: 162, name: 'Snook Creek Public Boat Ramp', inventoryOnly: true, notes: ['no official page checked'] },
  { oid: 159, name: 'Riverland Woods Park Boat Ramp', inventoryOnly: true, notes: ['no official page checked'] },
  // Miami-Dade: motorized public saltwater ramps from the FWC inventory only (no Miami-Dade ramp brief was available).
  { oid: 1337, name: 'Haulover Marine Center (Bill Bird Marina) Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1341, name: 'Pelican Harbor Park Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1344, name: 'Legion Park Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1342, name: 'Morningside Park Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1343, name: 'Gerry Curtis Park Boat Ramp (Miami River)', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1324, name: 'Watson Island Lot 70 Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1345, name: 'Regatta Park — Seminole Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1336, name: 'Crandon Park Marina Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1335, name: 'Matheson Hammock Park Marina Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1340, name: 'Black Point Park Marina Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
  { oid: 1338, name: 'Homestead Bayfront Park Marina Boat Ramp', inventoryOnly: true, notes: ['Miami-Dade: FWC inventory only; no official page checked — verify hours, fees and PWC rules before going.'] },
];
export const EXCLUDED_RAMPS = [142, 128, 137, 186, 195, 155, 164, 1349, 1332, 1370, 1359];
const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const normPhone = (s) => (s && s !== 'NA' ? s.replace(/[()]/g, '').replace(/\s+/, '-').trim() : null);
const ramps = CURATED.map((c) => {
  const f = rampById[c.oid];
  if (!f) throw new Error(`ramp OBJECTID ${c.oid} missing from inventory`);
  if (EXCLUDED_RAMPS.includes(c.oid)) throw new Error(`ramp ${c.oid} is on the excluded list`);
  const p = f.properties;
  if (p.WaterType !== 'Salt or Brackish Water' || p.RampType === 'Hand Launch Only') throw new Error(`ramp ${c.oid} is not a motorized saltwater ramp`);
  const invHours = p.Hours || null;
  const invFee = p.isFeeRequired === 'Yes' ? (p.FeeAmount ? `$${p.FeeAmount} (${p.FeeCollectionType})` : 'Fee required') : (p.isFeeRequired === 'No' ? 'Free' : null);
  const off = c.official || {};
  const conflicts = [...(c.conflicts || [])];
  const notes = [...(c.notes || [])];
  const invPhone = normPhone(p.ContactPhone);
  if (off.phone && invPhone && invPhone.replace(/\D/g, '') !== off.phone.replace(/\D/g, '')) {
    conflicts.push(`Phone: FWC inventory "${p.ContactPhone}" vs official "${off.phone}" (official used)`);
  }
  if (off.url && p.URL && p.URL !== off.url) notes.push(`FWC inventory URL: ${p.URL}`);
  if (!c.inventoryOnly) notes.push(`Official facts (${Object.keys(off).join(', ')}) ${BRIEF}.`);
  const status = c.status || (p.Status === 'Open for Business' ? 'open' : p.Status === 'Temporarily Closed' ? 'closed' : 'verify');
  if (p.Status !== 'Open for Business' && status === 'open') throw new Error(`ramp ${c.oid}: inventory status ${p.Status}`);
  const [lon, lat] = f.geometry.coordinates;
  return {
    id: `fwc-ramp-${c.oid}`,
    name: c.name,
    county: p.County === 'MIAMI-DADE' ? 'MIAMI-DADE' : 'BROWARD',
    lat: r6(lat), lon: r6(lon),
    address: off.address || c.address || p.Street1 || null,
    city: titleCase(p.City),
    waterbody: p.WaterBodyName,
    phone: off.phone || invPhone,
    url: off.url || p.URL || null,
    hours: 'hours' in c ? c.hours : (off.hours || invHours),
    fee: 'fee' in c ? c.fee : (off.fee || invFee),
    status,
    pwcDefault: true,
    source: c.inventoryOnly ? 'fwc-inventory' : 'official+inventory',
    conflicts,
    notes,
    fwc: {
      OBJECTID: p.OBJECTID, RampID: p.RampID, RampName: p.RampName, RampType: p.RampType, AccessType: p.AccessType,
      PrimaryAdminEntity: p.PrimaryAdminEntity, Status: p.Status, Hours: p.Hours, isFeeRequired: p.isFeeRequired,
      FeeAmount: p.FeeAmount, FeeCollectionType: p.FeeCollectionType, Street1: p.Street1, City: p.City, ZipCode: p.ZipCode,
      WaterType: p.WaterType, WaterBodyName: p.WaterBodyName, HydrologicalType: p.HydrologicalType, TotalLanes: p.TotalLanes,
      Trailer: p.Trailer, ContactPhone: p.ContactPhone, URL: p.URL, RampStatusComments: p.RampStatusComments,
      last_edited_date: p.last_edited_date,
    },
  };
});
writeJSON('ramps.json', {
  metadata: {
    source: 'FWC Florida Boat Ramp Inventory (MapServer layer 4, Broward), curated; official facts per project brief',
    url: [FWC.ramps_broward, FWC.ramps_md],
    fetched: FETCHED,
    count: ramps.length,
    notes: 'PWC default = motorized public ramps with tidal access: Broward ICW, inlets, New River/Stranahan, Dania Cut-off and Hillsboro Canal; Miami-Dade Biscayne Bay and Miami River (FWC inventory only). ' +
      'Excluded: hand-launch/no-motor, resident/member-only, freshwater inland and Everglades/WMA ramps. ' +
      'Official pages could not be fetched from the build sandbox; facts marked "per project brief". No live capacity feed exists. Call ahead.',
    excludedOBJECTIDs: EXCLUDED_RAMPS,
  },
  ramps,
});

// ---------- report ----------
console.log(`manatee.geojson   ${manateeFeatures.length} features ${JSON.stringify(manateeCounts)} (raw ${manateeRaw.length})`);
console.log(`bra.geojson       ${braFeatures.length} features`);
console.log(`digitized.geojson ${digitizedFeatures.length} features`);
for (const f of digitizedFeatures) {
  const b = geomBbox(f.geometry);
  const wM = ((b[2] - b[0]) * 111320 * Math.cos((b[1] * Math.PI) / 180)).toFixed(0);
  const hM = ((b[3] - b[1]) * 110574).toFixed(0);
  console.log(`  ${f.properties._id.padEnd(28)} bbox ${b.map((x) => x.toFixed(5)).join(',')}  ~${wM}x${hM} m  area ${area(f).toFixed(0)} m²`);
}
console.log(`uscg_points.json  buoyPE ${buoyPE}`);
console.log(`ramps.json        ${ramps.length} ramps`);
for (const r of ramps) console.log(`  ${r.id.padEnd(14)} ${r.status.padEnd(6)} pwc=${r.pwcDefault} ${r.source.padEnd(18)} ${r.name}${r.conflicts.length ? '  CONFLICTS: ' + r.conflicts.join(' | ') : ''}`);
