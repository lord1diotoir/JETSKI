# PWC Zones — Miami-Dade + Broward (build contract)

Static web app (no framework, ES modules, Leaflet 1.9.4 vendored from node_modules).
Node 22 for scripts/tests (`node --test`). Package is `"type": "module"`.

The Miami-Dade base app did not exist in this workspace, so this repo is a fresh app that covers both
counties with one rule engine. Broward is fully specified; Miami-Dade gets the FWC manatee layer only.

## Layout (ownership)
- `src/engine/` — rule engine, pure JS, no DOM, runs in Node and browser. **Owner: engine agent.**
  - `time.js`, `holidays.js`, `schedule.js`, `normalize.js`, `geo.js`, `evaluate.js`, `index.js` (re-exports)
- `test/` — `node --test` tests. Engine agent writes `test/engine.*.test.js`; data agent writes `test/data.test.js`.
- `scripts/build-data.mjs` + `public/data/*.geojson|json` — **Owner: data agent.**
- `public/index.html`, `public/app.js`, `public/styles.css`, `public/vendor/` — **Owner: UI agent.**
  `public/engine/` is a copy of `src/engine/` made by `npm run sync-engine` (UI agent adds that script: `cp -r src/engine public/`).
- `data/raw/` — snapshots fetched 2026-11-16 from FWC (do not edit):
  `manatee_broward.geojson` (23), `manatee_md.geojson` (47), `bra_broward.geojson` (20), `ramps_broward.geojson` (76),
  `ecfr_165.760.xml`, `ecfr_165.765.xml`, `ecfr_165.711.xml`.

## Global constants
- Clip bbox: lon -80.55 to -80.05, lat 25.30 to 26.35. Time zone: `America/New_York`.
- Seasons (from feature DATE fields, never hard-coded across counties):
  Miami-Dade NOV 15 - APR 30 / MAY 1 - NOV 14; Broward NOV 15 - MAR 31 / APR 1 - NOV 14.

## Data contract (public/data/, produced by build-data.mjs)
All GeoJSON FeatureCollections in EPSG:4326, features filtered to those intersecting the bbox.
Top-level FeatureCollection gets `"metadata": {source, url, fetched:"2026-11-16", count, notes}`.

1. `manatee.geojson` — Broward + Miami-Dade FWC layer 9 features. Keep all original properties
   (`OBJECTID, CLASS1_68C, DATE1_68C, CLASS2_68C, DATE2_68C, SECT_68C, TEXT_68C, NOTES_68C, COUNTY, last_edited_date`), add
   `_layer:"manatee"`, `_id:"fwc68c-<OBJECTID>"`.
2. `bra.geojson` — Broward 68D-24.008 layer 10 (20 features). Keep `AREA_NUM, AREA_NAME, RESTRICTION, CON_SHORT, CON_LON,
   DATE_IMP, NOTES, HYPERLINK, last_edited_date`, add `_layer:"bra"`, `_id:"fwc68d-<OBJECTID>"`.
   Feature OBJECTID 152 (AREA_NUM `68D-24.008(1)(a)14.c.`, NOTES "To be voted on by Commission 8/5/2021", DATE_IMP null)
   gets `_status:"unconfirmed"`. Everything else `_status:"gis"`.
3. `digitized.geojson` — hand-digitized features, each with properties:
   `{_layer, _id, _status:"digitized", name, rule, ruleUrl, restriction, schedule, notes, method}` where
   `restriction` ∈ {"No Entry Without COTP Permission","Slow Speed","Slow Speed Minimum Wake"} and `schedule`="At All Times".
   - `uscg-760-midnorth` (_layer "uscg") 33 CFR 165.760(b)(3) Mid-Port→North-Port fixed security zone.
   - `uscg-760-midsouth` (_layer "uscg") 165.760(b)(3) west of ICW, Mid-Port south to Dania Cut-Off.
   - `uscg-765-rna` (_layer "uscg") 165.765 slow speed RNA, vessels < 150 m.
   - `fwc68d-lauderdale-beach-icw` (_layer "bra") — Lauderdale Beach ICW Zone, Slow Speed Minimum Wake, all year,
     amendment eff. 2026-02-03 (https://flrules.org/Gateway/View_notice.asp?id=30326291), missing from GIS.
     Rule text could NOT be fetched (Cloudflare challenge) → `_status:"digitized"` and notes say "digitized from
     the notice summary; verify against the FAC text".
4. `uscg_points.json` — `{buoyPE:[lon,lat], carrierMooring:[lon,lat], moving:[...]}` with descriptions for 165.760 moving zones
   (100 yd, active west of Buoy PE) and 165.711 (700 yd ahead / 500 astern / 350 each side), plus `cotpPhone:"305-535-4472"`, `vhf:16`.
   Also `portEvergladesAlertArea`: a GeoJSON Polygon around the port basin used for the early warning banner.
5. `ramps.json` — `{ramps:[...]}`, curated. Each:
   `{id, name, lat, lon, address, city, waterbody, phone, url, hours, fee, status:"open"|"closed"|"verify",
     pwcDefault:boolean, source:"fwc-inventory"|"official+inventory", conflicts:[string], notes:[string], fwc:{...raw subset}}`.

## Engine contract (src/engine/index.js exports)
```js
// time
localParts(date: Date, tz='America/New_York') -> {year, month(1-12), day, dow(0=Sun..6), hour, minute, minutes /*since midnight*/}
zonedToDate({year,month,day,hour,minute}, tz) -> Date      // wall clock → instant (DST-safe)
// holidays (§ 110.117, F.S.)
floridaHolidays(year) -> [{date:'YYYY-MM-DD', name, observed:boolean}]   // actual + observed (Sat→Fri, Sun→Mon)
isFloridaHoliday({year,month,day}) -> null | {name, observed}
// schedule
parseDateRange('NOV 15 - MAR 31') -> {start:[11,15], end:[3,31]}         // inclusive, wraps year
inSeason(range, {month,day}) -> boolean
matchesWhen(when, parts) -> boolean   // when: {season?, days?:'all'|'weekend_holiday'|'weekday_nonholiday', time?:{start:'07:00', end:'19:00'}}
// normalize: GeoJSON feature -> Zone
normalizeFeature(feature) -> Zone
normalizeAll(featureCollections[]) -> Zone[]
// Zone = {id, layer:'manatee'|'bra'|'uscg', county, name, rule, ruleUrl, status:'gis'|'digitized'|'unconfirmed',
//         regimes:[{restriction, when, label}], notes, geometry, sourceProps}
// restriction = {kind:'no_entry'|'restricted_entry'|'motor_prohibited'|'idle'|'slow'|'max_mph', mph?, wakeIn?, dBA?, label}
// evaluate
activeRegime(zone, parts) -> {restriction, label, regimeIndex} | null   // first matching regime; null = no restriction now
nextChange(zone, date) -> {at: Date, restriction|null, label} | null    // next instant the active regime differs (search ≤ 400 days)
severity(restriction) -> number   // no_entry 1000, restricted_entry 950, motor_prohibited 900, idle 800, slow 700, max_mph 100-mph
zonesAtPoint(zones, [lon,lat]) -> Zone[]
evaluatePoint(zones, [lon,lat], date) -> {effective, contributions:[{zone, active, next}], warnings:[string]}
nearbyZones(zones, [lon,lat], meters, filterFn) -> [{zone, distanceM}]
```

### Required rule mappings
- Manatee CLASS codes: `NEAY`/`NE` no entry, `MPAY` motorboats prohibited, `ISAY`/`IS` idle, `SSAY`/`SS` slow, `"25 MPH"` etc → max_mph,
  `"SS WKND"` = Slow Speed only when in DATE1 season AND (Sat|Sun|FL holiday) AND 07:00 ≤ local time < 19:00; otherwise
  CLASS2 restriction (25 mph) — this covers 68C-22.010(2)(e),(g) exactly. Generic regime order: [CLASS1 when DATE1 (+ extra conds),
  CLASS2 when DATE2, and for SS WKND a fallback CLASS2 regime with no conditions].
  Unknown codes → regime with kind 'slow' label 'Unknown code — obey posted signs' + warning (fail safe, never silently no restriction).
- `Slow Speed Buffer (All Year)` is plain slow speed.
- BRA RESTRICTION: 'Idle Speed No Wake' → idle; 'Slow Speed Minimum Wake' → slow; 'Slow Speed Minimum Wake - Conditional'
  with CON_SHORT 'Saturdays, Sundays and Holidays' → slow only on weekend_holiday, all day, else no restriction;
  'Max Speed 30 MPH / Max Wake 15 Inches / Max Sound 80 dBA' → max_mph 30, wakeIn 15, dBA 80 (countywide ICW/New River, (1)(b)).
- Digitized: 'No Entry Without COTP Permission' → restricted_entry; slow variants → slow.
- Strictest wins at a point (severity). Unconfirmed/digitized zones still count (fail safe) but evaluatePoint adds a warning
  naming them. Always add warning "Posted signs prevail; FAC prevails over GIS (68C-22.010(5))" in UI, not engine.
- Holidays: treat BOTH the actual date and the observed date as holidays (conservative). § 110.117(1): New Year's Day,
  MLK (3rd Mon Jan), Memorial Day (last Mon May), Independence Day, Labor Day (1st Mon Sep), Veterans' Day (Nov 11),
  Thanksgiving (4th Thu Nov), Friday after Thanksgiving, Christmas.
