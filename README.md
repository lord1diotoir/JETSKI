# PWC Zones: Miami-Dade + Broward

PWC Zones is a static web map for personal watercraft (jet ski) riders. It covers waters from Golden Beach north to the Palm Beach County line: Hallandale, Hollywood, Dania Beach, Port Everglades, Fort Lauderdale, Pompano Beach, Lighthouse Point and Deerfield Beach/Hillsboro Inlet. It also includes the Miami-Dade manatee zones.

For any date and time (live, or one you pick), the map shows the speed or entry restriction in force in each zone. Click any spot to see the strictest rule there, the zones that contribute to it and when each one changes next.

> **Posted signs prevail. The FAC prevails over GIS (68C-22.010(5)). Not for navigation.**

The Miami-Dade base app was not present in this workspace. This repo is a standalone app that runs both counties through one rule engine. Broward is fully specified. **For Miami-Dade, only the FWC manatee zones (68C-22.025) are included.**

## Features

- **Clock**
  - **Live** mode uses America/New_York and re-evaluates every 30 s.
  - **Pick date/time** mode treats the value you enter as New York wall-clock time.
  - Presets: Next Sat 10:00, Next weekday 10:00, Sat 20:00, and Apr 15 (Broward off-season, Miami-Dade in-season).
  - The header shows the day, the time, the Broward and Miami-Dade manatee seasons (taken from the FWC data) and Florida holidays under § 110.117, F.S., including observed dates.
- **Zones** are colored by the restriction active at the selected time:
  - dark red: no entry or motorboats prohibited
  - red: idle speed
  - orange: slow speed
  - yellow: maximum speed (lighter for 30/35 MPH)
  - grey dashed outline: no restriction right now
- **Status tags**
  - DIGITIZED zones (dashed outline) were drawn by hand and are not official GIS.
- **Time-dependent zones panel** lists every zone whose rule changes by season, day or hour. It shows the current state and the next change, for example "Slow Speed until Sat 7:00 PM, then Max 25 MPH". Click an entry to zoom to it.
- **Point check**: click the map to see the effective restriction, every contributing zone with its rule citation and link, the next change, and any warnings.
- **Locate me** follows your GPS position and evaluates it continuously.
  - A persistent red **Port Everglades** banner appears when you are inside the port alert area or within 400 m of a USCG security zone.
  - Info markers mark Buoy PE and the carrier mooring.
  - **No AIS or ship-tracking feed is shown.** The moving security zones around ships cannot be mapped.
- **Ramps** are colored by status: open, verify or closed. Each popup shows the address, hours, fee, phone, website, source, conflicting information and notes. There is no official live capacity feed, so call ahead. The popup warns when the selected time falls on a weekend or holiday.
- **Layout**: layer toggles (68C, 68D, USCG, Ramps) and a county filter. Under 700 px wide, the side panel becomes a bottom sheet. Light and dark themes follow your system setting.

## Run

Requires Node 22 and Python 3.

```sh
npm install          # leaflet + turf (Leaflet is vendored into public/vendor/leaflet)
npm run build-data   # data/raw snapshots -> public/data/*
npm test             # node --test test/
npm run serve        # sync-engine + python3 -m http.server 8080 -d public
# open http://localhost:8080
```

`npm run sync-engine` copies `src/engine` to `public/engine`. The browser imports the same rule engine the tests use. There is no build step and no framework: the app is ES modules plus Leaflet 1.9.4. Map tiles are © OpenStreetMap contributors.

## Layout

| Path | What |
|---|---|
| `public/index.html`, `public/app.js`, `public/styles.css` | UI |
| `public/vendor/leaflet/` | Leaflet 1.9.4 (copied from `node_modules/leaflet/dist`) |
| `src/engine/` → `public/engine/` | Rule engine: time zones, FL holidays, schedules, normalization, geometry, evaluation |
| `scripts/build-data.mjs` → `public/data/` | Data build from `data/raw/` snapshots |
| `SPEC.md` | Engine and data contract |

## Data sources and caveats

- **FWC Boating & Waterways GIS**
  - layer 9: Manatee Protection Zones, 68C-22
  - layer 10: Boating Restricted Areas, 68D-24
  - layer 4: boat ramp inventory

  All three were fetched **2026-11-16**. The 68D layer was last edited in GIS on **2025-06-03**.
- **68D-24.006** was repealed in 2013 and is not used.
- **Lauderdale Beach ICW Zone**, 68D-24.008(1)(a)15. (effective **2026-02-03**): rule text checked against the FAC (`data/raw/fac_68D-24.008_eff-2026-02-03.txt`, FAR notice in `data/raw/far_notice_68D-24.008_lauderdale-beach.txt`). It is missing from GIS, so the polygon is **DIGITIZED**. It fills the ICW between the Oakland Park idle zone (1,500 ft south of that bridge) and the Sunrise idle zone (2,250 ft north of that bridge), exactly as the rule defines it. Not survey grade.
- **Hallandale Beach Blvd, 68D-24.008(1)(a)14.c**: confirmed in force against the FAC text (adopted in the 9-27-21 amendment). The GIS note "To be voted on by Commission 8/5/2021" is out of date.
- **USCG**: the 33 CFR 165.760 fixed security zones and the 165.765 slow-speed area at Port Everglades use NOAA's official harbor chart geometry (ENC cells US5PEFBA/US5PEFCA, snapshot in `data/raw/noaa_enc_resare_port_everglades.geojson`). It follows the real pier faces and shoreline, and every coordinate in the regulations lies within 16 m of NOAA's boundary; the build fails if that stops being true. The moving zones are shown only as text: 100 yd around cruise ships and tankers west of Buoy PE (165.760), and 700/500/350 yd around aircraft carriers (165.711). 33 CFR 334.580 (Navy area off Port Everglades and Dania Beach) bans anchoring, trawling and dredging but not passing through. COTP Miami: 305-535-4472 / VHF 16.
- **County and city ordinances are NOT digitized.** Municode could not be reached from the build environment, and no polygons were made up. Rules in Hollywood, Hallandale Beach and Pompano Beach were not checked.
  - [Broward County Code of Ordinances](https://library.municode.com/fl/broward_county/codes/code_of_ordinances)
  - [Fort Lauderdale Ch. 8 §8-166](https://library.municode.com/fl/fort_lauderdale/codes/code_of_ordinances?nodeId=COOR_CH8BODOBEWA_ARTVBOWA_DIV2WASARU_S8-166SPLIWA)
  - [Lighthouse Point Ch. 90](https://library.municode.com/fl/lighthouse_point/codes/code_of_ordinances?nodeId=PTIICICO_CH90WA)
  - [Deerfield Beach Ch. 74 §74-46](https://library.municode.com/fl/deerfield_beach/codes/code_of_ordinances?nodeId=PTIICOOR_CH74WA_ARTIIBO_DIV2ABWRJUVE_S74-46ABVEGE)
  - [Dania Beach Code of Ordinances](https://library.municode.com/fl/dania_beach/codes/code_of_ordinances)
- **FWC official maps**
  - [Broward manatee zones (PDF)](https://myfwc.com/media/7289/browardmpz-maps.pdf)
  - [Broward BRA maps (PDF)](https://myfwc.com/media/7288/browardmpz-bramaps.pdf)
- The **Broward GeoHub** boating-facilities layer is a 2018 PDF, and `EEPD_Marine_Facility` returned 403. Neither is used.
- **No official live ramp-capacity feed exists.** Lots fill on weekends and holidays.
- **Palm Beach County 68D-24.017** (Camino Real Bridge to the county line: Slow Speed on weekends and holidays, 10 am–6 pm) is mentioned for context only. There is no polygon for it.
- **Holidays**: both the actual date and the observed date count as holidays. The Sunrise Blvd Bridge South zone, 68D-24.008(1)(a)7.b., defines holidays by Rule 68D-24.002, F.A.C., which was not checked. The § 110.117 list is used as a cautious stand-in.
- Unknown zone codes fall back to Slow Speed with a warning. A zone never silently shows "no restriction".
