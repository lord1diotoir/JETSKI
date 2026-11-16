// PWC Zones UI. Static ES module; the rule engine lives in ./engine (copied from src/engine by `npm run sync-engine`).
import {
  localParts, zonedToDate, isFloridaHoliday, parseDateRange, inSeason,
  normalizeAll, activeRegime, nextChange, evaluatePoint, nearbyZones, zonesAtPoint,
} from './engine/index.js';

const TZ = 'America/New_York';
const L = window.L;
const BOUNDS = L.latLngBounds([25.30, -80.55], [26.35, -80.05]);
const DISCLAIMER = 'Posted signs prevail. The FAC prevails over GIS (68C-22.010(5)). Not for navigation.';
const PE_ALERT_RADIUS_M = 400;
const LIVE_REFRESH_MS = 30_000;

// Fallback seasons only used if the data does not carry a seasonal feature for a county.
const SEASON_FALLBACK = { BROWARD: 'NOV 15 - MAR 31', 'MIAMI-DADE': 'NOV 15 - APR 30' };

const COLORS = {
  noentry: '#7a0012', idle: '#e0201b', slow: '#f07c00', mph: '#e3b500', mphLight: '#f5dc6b', none: '#8a939c',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

// ---------------------------------------------------------------- state
const state = {
  mode: 'live',
  picked: null,               // Date when mode === 'pick'
  zones: [],
  zoneLayers: new Map(),       // zone.id -> L.Path layer group
  tagTooltips: new Map(),      // zone.id -> tooltip for DIGITIZED / UNCONFIRMED tags
  timeDependent: [],
  uscgPoints: null,
  ramps: [],
  clickPoint: null,            // [lon, lat]
  clickPopup: null,
  gpsPoint: null,
  gpsAccuracy: null,
  watchId: null,
  bannerDismissedFor: null,
  seasons: { BROWARD: null, 'MIAMI-DADE': null },
};

const currentDate = () => (state.mode === 'pick' && state.picked ? state.picked : new Date());

// ---------------------------------------------------------------- formatting
const fmtFull = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const fmtShortDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDated = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function fmtWhen(at, ref) {
  const days = (at - ref) / 86400000;
  return days < 6 ? fmtShortDay.format(at) : fmtDated.format(at);
}

function shortLabel(restriction) {
  if (!restriction) return 'No restriction';
  return restriction.label || restriction.kind;
}

/** "Slow Speed Minimum Wake until Sat 7:00 PM, then Max 25 MPH" */
function describeNow(active, next, ref) {
  const now = active ? shortLabel(active.restriction) : 'No restriction now';
  if (!next) return { now, next: 'No change within 400 days' };
  return { now, next: `until ${fmtWhen(next.at, ref)}, then ${next.restriction ? shortLabel(next.restriction) : 'no restriction'}` };
}

// ---------------------------------------------------------------- styling
function restrictionColor(r) {
  if (!r) return COLORS.none;
  switch (r.kind) {
    case 'no_entry': case 'restricted_entry': case 'motor_prohibited': return COLORS.noentry;
    case 'idle': return COLORS.idle;
    case 'slow': return COLORS.slow;
    case 'max_mph': return Number(r.mph) >= 30 ? COLORS.mphLight : COLORS.mph;
    default: return COLORS.slow;
  }
}
function effClass(r) {
  if (!r) return 'k-none';
  return `k-${r.kind}${r.kind === 'max_mph' && Number(r.mph) >= 30 ? ' light' : ''}`;
}

function zoneStyle(zone, active) {
  const r = active ? active.restriction : null;
  const color = restrictionColor(r);
  const style = {
    color, weight: 2, opacity: 0.95, fillColor: color, fillOpacity: 0.28, dashArray: null, lineCap: 'round',
  };
  if (!r) Object.assign(style, { weight: 1.5, fillOpacity: 0.04, dashArray: '6 6' });
  if (r && r.kind === 'max_mph') style.fillOpacity = Number(r.mph) >= 30 ? 0.10 : 0.18;
  if (zone.layer === 'bra' && r && r.kind === 'max_mph') style.fillOpacity = 0.06; // countywide ICW zone: keep the map readable
  if (zone.status === 'digitized') Object.assign(style, { dashArray: '10 6', weight: 2.5 });
  if (zone.status === 'unconfirmed') Object.assign(style, { dashArray: '1 6', weight: 3.5, fillOpacity: Math.min(style.fillOpacity, 0.15) });
  return style;
}

function statusTag(status) {
  if (status === 'digitized') return '<span class="tag tag-digitized">DIGITIZED</span>';
  if (status === 'unconfirmed') return '<span class="tag tag-unconfirmed">UNCONFIRMED</span>';
  return '<span class="tag tag-gis">GIS</span>';
}

// ---------------------------------------------------------------- map
const map = L.map('map', {
  maxBounds: BOUNDS.pad(0.15),
  minZoom: 9,
  zoomControl: true,
  preferCanvas: false,
}).setView([26.10, -80.12], 12);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Zones: FWC, eCFR',
}).on('tileerror', () => {
  // Some hosts (e.g. the claude.ai page) block map tiles. Zones still draw; say so once.
  if (document.getElementById('tile-note')) return;
  const n = document.createElement('div');
  n.id = 'tile-note';
  n.className = 'tile-note';
  n.textContent = 'Background map tiles could not load here. Zones, ramps and rules still work; open the app locally for the street map.';
  document.getElementById('map').appendChild(n);
}).addTo(map);

// Low-severity zones underneath so small strict zones stay clickable/visible on top.
map.createPane('zonesLow').style.zIndex = 395;
map.createPane('zonesMid').style.zIndex = 400;
map.createPane('zonesHigh').style.zIndex = 405;

const groups = {
  manatee: L.layerGroup().addTo(map),
  bra: L.layerGroup().addTo(map),
  uscg: L.layerGroup().addTo(map),
  ramps: L.layerGroup().addTo(map),
  uscgInfo: L.layerGroup().addTo(map),
  me: L.layerGroup().addTo(map),
};

function paneFor(zone) {
  const kinds = zone.regimes.map((g) => g.restriction.kind);
  if (kinds.every((k) => k === 'max_mph')) return 'zonesLow';
  if (kinds.some((k) => k === 'no_entry' || k === 'restricted_entry' || k === 'idle' || k === 'motor_prohibited')) return 'zonesHigh';
  return 'zonesMid';
}

function countyKey(zone) {
  const c = String(zone.county || '').toUpperCase();
  if (c.includes('DADE') || c.includes('MIAMI')) return 'miami-dade';
  if (c.includes('BROWARD')) return 'broward';
  return 'other';
}

function buildZoneLayers() {
  for (const zone of state.zones) {
    const layer = L.geoJSON(zone.geometry, { pane: paneFor(zone), style: () => zoneStyle(zone, null) });
    layer.bindTooltip(() => tooltipHtml(zone), { sticky: true, direction: 'top', opacity: 0.95 });
    state.zoneLayers.set(zone.id, layer);
    if (zone.status === 'digitized' || zone.status === 'unconfirmed') {
      const center = layer.getBounds().getCenter();
      const t = L.tooltip({ permanent: true, direction: 'center', className: 'zone-tag', interactive: false })
        .setLatLng(center)
        .setContent(statusTag(zone.status));
      state.tagTooltips.set(zone.id, t);
    }
  }
}

function tooltipHtml(zone) {
  const date = currentDate();
  const active = activeRegime(zone, localParts(date, TZ));
  return `<b>${esc(zone.name)}</b> ${zone.status !== 'gis' ? statusTag(zone.status) : ''}<br>${esc(active ? active.label : 'No restriction now')}`;
}

function applyLayerVisibility() {
  const county = $('county-filter').value;
  const on = {
    manatee: $('lyr-manatee').checked, bra: $('lyr-bra').checked, uscg: $('lyr-uscg').checked,
  };
  for (const zone of state.zones) {
    const layer = state.zoneLayers.get(zone.id);
    const grp = groups[zone.layer] || groups.uscg;
    const visible = (on[zone.layer] ?? true) && (county === 'all' || countyKey(zone) === county);
    if (visible && !grp.hasLayer(layer)) grp.addLayer(layer);
    if (!visible && grp.hasLayer(layer)) grp.removeLayer(layer);
    const tag = state.tagTooltips.get(zone.id);
    if (tag) {
      if (visible && !map.hasLayer(tag)) tag.addTo(map);
      if (!visible && map.hasLayer(tag)) map.removeLayer(tag);
    }
  }
  toggleGroup(groups.uscgInfo, on.uscg && county !== 'miami-dade');
  toggleGroup(groups.ramps, $('lyr-ramps').checked && county !== 'miami-dade');
}
function toggleGroup(g, on) {
  if (on && !map.hasLayer(g)) g.addTo(map);
  if (!on && map.hasLayer(g)) map.removeLayer(g);
}

// ---------------------------------------------------------------- time-dependent zones
function isTimeDependent(zone) {
  const keys = new Set(zone.regimes.map((g) => `${g.restriction.kind}|${g.restriction.mph ?? ''}`));
  if (keys.size > 1) return true;
  return zone.regimes.some((g) => g.when && (g.when.time || (g.when.days && g.when.days !== 'all') || g.when.season));
}

function renderTimeDependent(date) {
  const parts = localParts(date, TZ);
  const list = $('td-list');
  const county = $('county-filter').value;
  const items = state.timeDependent.filter((z) => county === 'all' || countyKey(z) === county);
  if (!items.length) { list.innerHTML = '<li class="none-here">None for this filter.</li>'; return; }
  list.innerHTML = items.map((zone) => {
    const active = activeRegime(zone, parts);
    const next = nextChange(zone, date, TZ);
    const d = describeNow(active, next, date);
    const color = restrictionColor(active ? active.restriction : null);
    return `<li tabindex="0" data-zone="${esc(zone.id)}" style="border-left-color:${color}">
      <div class="td-name">${esc(zone.name)} ${zone.status !== 'gis' ? statusTag(zone.status) : ''}</div>
      <div class="td-now"><span class="swatch-inline" style="background:${color}"></span>${esc(d.now)}</div>
      <div class="td-next">${esc(d.next)}</div>
      <div class="td-next">${esc(zone.rule)} · ${esc(countyLabel(zone))}</div>
    </li>`;
  }).join('');
}
function countyLabel(zone) {
  const k = countyKey(zone);
  return k === 'miami-dade' ? 'Miami-Dade' : k === 'broward' ? 'Broward' : String(zone.county || '');
}

$('td-list').addEventListener('click', (e) => zoomToZoneFromEvent(e));
$('td-list').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomToZoneFromEvent(e); } });
function zoomToZoneFromEvent(e) {
  const li = e.target.closest('li[data-zone]');
  if (!li) return;
  const layer = state.zoneLayers.get(li.dataset.zone);
  if (!layer) return;
  const b = layer.getBounds();
  map.fitBounds(b, { maxZoom: 16, padding: [30, 30] });
  layer.setStyle({ weight: 5 });
  setTimeout(() => restyleZones(currentDate()), 1200);
  if (window.matchMedia('(max-width: 699px)').matches) setSheet(false);
}

// ---------------------------------------------------------------- header / clock
function deriveSeasons() {
  for (const county of ['BROWARD', 'MIAMI-DADE']) {
    const z = state.zones.find((zz) => zz.layer === 'manatee' && String(zz.county).toUpperCase() === county
      && parseDateRange(zz.sourceProps?.DATE1_68C) && zz.sourceProps.DATE1_68C.trim().toUpperCase() !== 'JAN 1 - DEC 31');
    const str = z ? z.sourceProps.DATE1_68C : SEASON_FALLBACK[county];
    const z2 = z ? z.sourceProps.DATE2_68C : null;
    state.seasons[county] = { inRange: parseDateRange(str), inStr: str, offStr: z2 || null };
  }
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyRange(str) {
  const r = parseDateRange(str);
  if (!r) return str || '';
  return `${MONTHS[r.start[0]]} ${r.start[1]}–${MONTHS[r.end[0]]} ${r.end[1]}`;
}

function renderHeader(date) {
  const parts = localParts(date, TZ);
  $('clock-time').textContent = fmtFull.format(date);
  const tag = $('clock-mode-tag');
  tag.textContent = state.mode === 'live' ? 'LIVE' : 'PICKED';
  tag.className = `tag ${state.mode === 'live' ? 'tag-live' : 'tag-picked'}`;

  for (const [county, el, name] of [['BROWARD', 'season-broward', 'Broward'], ['MIAMI-DADE', 'season-md', 'Miami-Dade']]) {
    const s = state.seasons[county];
    if (!s) continue;
    const inS = inSeason(s.inRange, parts);
    const node = $(el);
    node.textContent = inS
      ? `${name}: Manatee season ${prettyRange(s.inStr)}`
      : `${name}: off-season ${s.offStr ? prettyRange(s.offStr) : ''}`;
    node.classList.toggle('in-season', inS);
    node.title = `${name} manatee zone season dates from FWC GIS DATE1/DATE2 fields`;
  }

  const hol = isFloridaHoliday({ year: parts.year, month: parts.month, day: parts.day });
  const hn = $('holiday');
  if (hol) {
    hn.hidden = false;
    hn.textContent = `FL holiday: ${hol.name}${hol.observed ? ' (observed)' : ''}`;
  } else {
    hn.hidden = true;
  }
}

// ---------------------------------------------------------------- clock modes & presets
function pad(n) { return String(n).padStart(2, '0'); }
function toInputValue(date) {
  const p = localParts(date, TZ);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
function fromInputValue(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return null;
  return zonedToDate({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, TZ);
}
function calendarAdd({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay() };
}

function presetDate(kind) {
  const now = new Date();
  const p = localParts(now, TZ);
  const at = (d, hour) => zonedToDate({ year: d.year, month: d.month, day: d.day, hour, minute: 0 }, TZ);
  const upcoming = (pred, hour) => {
    for (let i = 0; i < 400; i++) {
      const d = calendarAdd(p, i);
      if (!pred(d)) continue;
      const t = at(d, hour);
      if (t > now) return t;
    }
    return null;
  };
  switch (kind) {
    case 'sat10': return upcoming((d) => d.dow === 6, 10);
    case 'sat20': return upcoming((d) => d.dow === 6, 20);
    case 'wkday10': return upcoming((d) => d.dow >= 1 && d.dow <= 5 && !isFloridaHoliday(d), 10);
    case 'apr15': {
      const y = (p.month > 4 || (p.month === 4 && p.day >= 15)) ? p.year + 1 : p.year;
      return at({ year: y, month: 4, day: 15 }, 10);
    }
  }
  return null;
}

function setMode(mode) {
  state.mode = mode;
  $('mode-live').classList.toggle('active', mode === 'live');
  $('mode-pick').classList.toggle('active', mode === 'pick');
  $('mode-live').setAttribute('aria-pressed', String(mode === 'live'));
  $('mode-pick').setAttribute('aria-pressed', String(mode === 'pick'));
  if (mode === 'pick' && !state.picked) state.picked = fromInputValue($('pick-input').value) || new Date();
  if (mode === 'live') $('pick-input').value = toInputValue(new Date());
  refresh();
}

$('mode-live').addEventListener('click', () => setMode('live'));
$('mode-pick').addEventListener('click', () => {
  state.picked = fromInputValue($('pick-input').value) || new Date();
  setMode('pick');
});
$('pick-input').addEventListener('change', () => {
  const d = fromInputValue($('pick-input').value);
  if (!d) return;
  state.picked = d;
  setMode('pick');
});
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  const d = presetDate(b.dataset.preset);
  if (!d) return;
  state.picked = d;
  $('pick-input').value = toInputValue(d);
  setMode('pick');
}));

// ---------------------------------------------------------------- refresh
function restyleZones(date) {
  const parts = localParts(date, TZ);
  for (const zone of state.zones) {
    const layer = state.zoneLayers.get(zone.id);
    if (!layer) continue;
    const active = activeRegime(zone, parts);
    layer.setStyle(zoneStyle(zone, active));
  }
}

function refresh() {
  const date = currentDate();
  renderHeader(date);
  if (!state.zones.length) return;
  restyleZones(date);
  renderTimeDependent(date);
  renderPoint();
  renderHere();
  renderRampsPopups();
  updateBanner();
}

setInterval(() => { if (state.mode === 'live') refresh(); }, LIVE_REFRESH_MS);

// ---------------------------------------------------------------- point evaluation
function inAlertPolygon(pt) {
  const area = state.uscgPoints?.portEvergladesAlertArea;
  if (!area) return false;
  const geom = area.type === 'Feature' ? area.geometry : area;
  return zonesAtPoint([{ id: '_pe', regimes: [], geometry: geom }], pt).length > 0;
}
function nearUscgRestricted(pt) {
  return nearbyZones(state.zones, pt, PE_ALERT_RADIUS_M,
    (z) => z.layer === 'uscg' && z.regimes.some((g) => g.restriction.kind === 'restricted_entry'));
}
function peAlert(pt) {
  if (!pt) return null;
  if (inAlertPolygon(pt)) return { reason: 'inside the Port Everglades alert area' };
  const near = nearUscgRestricted(pt);
  if (near.length) {
    const d = near[0].distanceM;
    return { reason: d === 0 ? `inside ${near[0].zone.name}` : `${Math.round(d)} m from ${near[0].zone.name}` };
  }
  return null;
}

function evalHtml(pt, date, { title } = {}) {
  const res = evaluatePoint(state.zones, pt, date, TZ);
  const eff = res.effective;
  const r = eff ? eff.restriction : null;
  const contribs = [...res.contributions].sort((a, b) => (a.active ? 0 : 1) - (b.active ? 0 : 1));
  const pe = peAlert(pt);
  const parts = localParts(date, TZ);
  const hol = isFloridaHoliday(parts);

  let html = `<div class="eval">`;
  if (title) html += `<div class="coord"><b>${esc(title)}</b></div>`;
  html += `<div class="coord">${pt[1].toFixed(5)}, ${pt[0].toFixed(5)} · ${esc(fmtDated.format(date))}${hol ? ` · ${esc(hol.name)}${hol.observed ? ' (observed)' : ''}` : ''}</div>`;
  html += `<div class="eff ${effClass(r)}">${esc(r ? shortLabel(r) : res.contributions.length ? 'No restriction now' : 'No mapped zone')}`;
  if (eff) html += `<small>${esc(eff.zone?.name || '')}</small>`;
  else if (!res.contributions.length) html += `<small>No FWC/USCG zone mapped here. Unmapped county/city ordinances may still apply.</small>`;
  html += `</div>`;
  if (pe) {
    html += `<div class="pe-inline"><b>Port Everglades security zone nearby</b> (${esc(pe.reason)}). No entry west of the ICW without COTP Miami permission:
      <a href="tel:+13055354472">305-535-4472</a> / VHF 16. Moving zones around ships are not shown. This app has no AIS feed.</div>`;
  }
  for (const c of contribs) {
    const z = c.zone;
    const color = restrictionColor(c.active ? c.active.restriction : null);
    const d = describeNow(c.active, c.next, date);
    const url = safeUrl(z.ruleUrl);
    html += `<div class="contrib">
      <div class="cname"><span class="swatch-inline" style="background:${color}"></span>${esc(z.name)} ${statusTag(z.status)}</div>
      <div class="crule">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(z.rule || 'rule')}</a>` : esc(z.rule)} · ${esc(layerLabel(z.layer))}</div>
      <div class="cnow">${esc(c.active ? c.active.label : 'No restriction at this time')}</div>
      <div class="cnext">${esc(c.next ? `Next: ${d.next}` : 'No scheduled change')}</div>
    </div>`;
  }
  if (res.warnings.length) html += `<ul class="warnings">${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
  html += `<div class="eval-footer">${esc(DISCLAIMER)}</div></div>`;
  return html;
}
function layerLabel(l) {
  return l === 'manatee' ? 'FWC manatee zone (68C)' : l === 'bra' ? 'FWC boating restricted area (68D)' : l === 'uscg' ? 'USCG (33 CFR 165)' : l;
}

map.on('click', (e) => {
  const pt = [e.latlng.lng, e.latlng.lat];
  state.clickPoint = pt;
  state.bannerDismissedFor = null;
  renderPoint(true);
  updateBanner();
});

function renderPoint(openPopup = false) {
  const card = $('point-card');
  if (!state.clickPoint || !state.zones.length) { card.hidden = true; return; }
  const date = currentDate();
  const html = evalHtml(state.clickPoint, date);
  card.hidden = false;
  $('point-body').innerHTML = html;
  const ll = [state.clickPoint[1], state.clickPoint[0]];
  if (openPopup) {
    state.clickPopup = L.popup({ maxWidth: 330, minWidth: 240, autoPanPaddingTopLeft: [10, 10] }).setLatLng(ll).setContent(html).openOn(map);
  } else if (state.clickPopup && map.hasLayer(state.clickPopup)) {
    state.clickPopup.setContent(html);
  }
}

// ---------------------------------------------------------------- banner
function updateBanner() {
  const banner = $('pe-banner');
  const gps = state.gpsPoint ? peAlert(state.gpsPoint) : null;
  const click = state.clickPoint && state.bannerDismissedFor !== state.clickPoint ? peAlert(state.clickPoint) : null;
  if (gps) {
    banner.hidden = false;
    $('pe-banner-src').textContent = `Your GPS position is ${gps.reason}.`;
    $('pe-banner-close').hidden = true;
  } else if (click) {
    banner.hidden = false;
    $('pe-banner-src').textContent = `Selected point is ${click.reason}.`;
    $('pe-banner-close').hidden = false;
  } else {
    banner.hidden = true;
  }
  setTimeout(() => map.invalidateSize(), 0);
}
$('pe-banner-close').addEventListener('click', () => { state.bannerDismissedFor = state.clickPoint; updateBanner(); });

// ---------------------------------------------------------------- geolocation
let meMarker = null, meCircle = null, firstFix = true;
$('locate-btn').addEventListener('click', () => {
  const btn = $('locate-btn');
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.gpsPoint = null;
    groups.me.clearLayers(); meMarker = meCircle = null;
    btn.textContent = 'Locate me'; btn.classList.remove('on');
    $('locate-status').textContent = '';
    $('here-card').hidden = true;
    updateBanner();
    return;
  }
  if (!('geolocation' in navigator)) { $('locate-status').textContent = 'Geolocation not available in this browser.'; return; }
  firstFix = true;
  $('locate-status').textContent = 'Waiting for GPS…';
  btn.textContent = 'Stop tracking'; btn.classList.add('on');
  state.watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
    $('locate-status').textContent = err.code === 1
      ? 'Location is blocked here. The claude.ai page cannot use GPS; run the app in a normal browser (npm run serve) to track your position.'
      : `Location error: ${err.message}`;
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
});

function onPosition(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  state.gpsPoint = [lon, lat];
  state.gpsAccuracy = accuracy;
  const ll = [lat, lon];
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: L.divIcon({ className: 'me-icon', iconSize: [16, 16] }), zIndexOffset: 1000, interactive: false }).addTo(groups.me);
    meCircle = L.circle(ll, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(groups.me);
  } else {
    meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(accuracy);
  }
  if (firstFix) { map.setView(ll, Math.max(map.getZoom(), 14)); firstFix = false; }
  $('locate-status').textContent = `±${Math.round(accuracy)} m · ${fmtShortDay.format(new Date(pos.timestamp))}`;
  if (!BOUNDS.contains(ll)) $('locate-status').textContent += ' · outside coverage area';
  renderHere();
  updateBanner();
}

function renderHere() {
  if (!state.gpsPoint || !state.zones.length) { $('here-card').hidden = true; return; }
  $('here-card').hidden = false;
  // Your own position is always evaluated at the real current time, even in "Pick" mode.
  const note = state.mode === 'pick' ? '<p class="hint">Evaluated at the real current time, not the picked time.</p>' : '';
  $('here-body').innerHTML = note + evalHtml(state.gpsPoint, new Date());
}

// ---------------------------------------------------------------- USCG info markers
function renderUscgInfo() {
  groups.uscgInfo.clearLayers();
  const u = state.uscgPoints;
  if (!u) return;
  const mk = (lonlat, label, html) => {
    if (!Array.isArray(lonlat)) return;
    L.marker([lonlat[1], lonlat[0]], {
      icon: L.divIcon({ className: 'pe-icon', html: label, iconSize: [label.length * 8 + 10, 18] }),
      title: label,
    }).bindPopup(html, { maxWidth: 320 }).addTo(groups.uscgInfo);
  };
  const movingList = Array.isArray(u.moving) ? u.moving.map((m) => `<li>${esc(describeMoving(m))}</li>`).join('') : '';
  const phone = u.cotpPhone || '305-535-4472';
  const common = `<p>COTP Miami: <a href="tel:+1${esc(phone.replace(/\D/g, ''))}">${esc(phone)}</a> · VHF ${esc(u.vhf ?? 16)}</p>
    <p><b>No AIS / ship-tracking feed is shown.</b> Moving security zones follow the ships. Keep a lookout and monitor VHF 16.</p>
    <p class="eval-footer">${esc(DISCLAIMER)}</p>`;
  mk(u.buoyPE, 'PE', `<div class="info-pop"><h3>${esc(u.buoyPEName || 'Port Everglades sea buoy "PE"')}</h3>
    <p>${esc(u.buoyPEDescription || 'West of Buoy PE, 100-yard moving security zones surround cruise ships, tankers and other designated vessels (33 CFR 165.760). Do not enter without COTP permission.')}</p>
    ${movingList ? `<ul>${movingList}</ul>` : ''}${common}</div>`);
  if (u.carrierMooring) {
    mk(u.carrierMooring, 'CVN', `<div class="info-pop"><h3>Aircraft carrier mooring / anchorage</h3>
      <p>${esc(u.carrierMooringDescription || '33 CFR 165.711: 700 yd ahead, 500 yd astern and 350 yd to each side of aircraft carriers. Do not enter without COTP permission.')}</p>${common}</div>`);
  }
}
function describeMoving(m) {
  if (typeof m === 'string') return m;
  if (!m || typeof m !== 'object') return String(m);
  const head = [m.rule || m.cfr, m.name || m.title].filter(Boolean).join(' — ');
  const body = [m.description || m.text || m.desc || '', m.activeWhere ? `Where: ${m.activeWhere}.` : ''].filter(Boolean).join(' ');
  return [head, body].filter(Boolean).join(': ') || JSON.stringify(m);
}

// ---------------------------------------------------------------- ramps
const RAMP_COLORS = { open: '#1a8a3a', verify: '#c98400', closed: '#7c7c7c' };
const rampMarkers = [];

function isWeekendOrHoliday(date) {
  const p = localParts(date, TZ);
  return p.dow === 0 || p.dow === 6 || !!isFloridaHoliday(p);
}

function rampHtml(r) {
  const date = currentDate();
  const status = ['open', 'closed', 'verify'].includes(r.status) ? r.status : 'verify';
  const url = safeUrl(r.url);
  const row = (k, v) => (v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`);
  const phones = r.phone ? String(r.phone).split(/\s*[;/,]\s*(?=\(?\d)/).map((ph) =>
    `<a href="tel:${esc(ph.replace(/[^\d+]/g, ''))}">${esc(ph)}</a>`).join(', ') : '';
  const list = (a) => (Array.isArray(a) ? a : a ? [a] : []);
  const conflicts = list(r.conflicts);
  const notes = list(r.notes);
  let h = `<div class="ramp-pop"><h3>${esc(r.name)}</h3>
    <span class="status-badge status-${status}">${status.toUpperCase()}</span>
    ${r.pwcDefault ? '' : ' <span class="tag tag-gis">inventory only</span>'}
    <dl>
      ${row('Address', esc([r.address, r.city].filter(Boolean).join(', ')))}
      ${row('Waterbody', esc(r.waterbody))}
      ${row('Hours', esc(r.hours))}
      ${row('Fee', esc(r.fee))}
      ${row('Phone', phones)}
      ${row('Website', url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, '').slice(0, 48))}</a>` : '')}
      ${row('Source', esc(r.source === 'official+inventory' ? 'Official page + FWC ramp inventory' : r.source === 'fwc-inventory' ? 'FWC ramp inventory (layer 4)' : r.source))}
    </dl>`;
  if (conflicts.length) h += `<div class="conflicts"><b>Conflicting information:</b><ul>${conflicts.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`;
  if (notes.length) h += `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  h += `<div class="capacity">No official live capacity feed exists. Call ahead; lots fill on weekends and holidays.</div>`;
  if (isWeekendOrHoliday(date)) {
    const hol = isFloridaHoliday(localParts(date, TZ));
    h += `<div class="weekend">The selected time is a ${hol ? `holiday (${esc(hol.name)})` : 'weekend'}. Expect full lots; arrive early or have a backup ramp.</div>`;
  }
  h += `</div>`;
  return h;
}

function buildRamps() {
  for (const r of state.ramps) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
    const status = ['open', 'closed', 'verify'].includes(r.status) ? r.status : 'verify';
    const m = L.circleMarker([r.lat, r.lon], {
      radius: r.pwcDefault ? 7 : 5, color: '#ffffff', weight: 2, fillColor: RAMP_COLORS[status], fillOpacity: 0.95, pane: 'markerPane',
    });
    m.bindPopup(() => rampHtml(r), { maxWidth: 320 });
    m.bindTooltip(esc(r.name), { direction: 'top' });
    m._ramp = r;
    rampMarkers.push(m);
  }
  applyRampFilter();
}
function applyRampFilter() {
  const all = $('ramps-all').checked;
  groups.ramps.clearLayers();
  for (const m of rampMarkers) if (all || m._ramp.pwcDefault) groups.ramps.addLayer(m);
}
function renderRampsPopups() {
  for (const m of rampMarkers) if (m.isPopupOpen()) m.setPopupContent(rampHtml(m._ramp));
}

// ---------------------------------------------------------------- controls
['lyr-manatee', 'lyr-bra', 'lyr-uscg', 'lyr-ramps'].forEach((id) => $(id).addEventListener('change', applyLayerVisibility));
$('county-filter').addEventListener('change', () => {
  applyLayerVisibility();
  renderTimeDependent(currentDate());
  const c = $('county-filter').value;
  if (c === 'miami-dade') map.flyTo([25.78, -80.20], 11);
  else if (c === 'broward') map.flyTo([26.12, -80.13], 11);
});
$('ramps-all').addEventListener('change', applyRampFilter);

function setSheet(open) {
  const panel = $('panel');
  panel.classList.toggle('collapsed', !open);
  $('sheet-toggle').setAttribute('aria-expanded', String(open));
  $('sheet-toggle-label').textContent = open ? 'Hide panel' : 'Show panel';
}
$('sheet-toggle').addEventListener('click', () => setSheet($('panel').classList.contains('collapsed')));

// ---------------------------------------------------------------- data loading
async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  $('pick-input').value = toInputValue(new Date());
  renderHeader(new Date());
  const files = ['data/manatee.geojson', 'data/bra.geojson', 'data/digitized.geojson', 'data/uscg_points.json', 'data/ramps.json'];
  const results = await Promise.allSettled(files.map(getJson));
  const failed = results.map((r, i) => (r.status === 'rejected' ? files[i] : null)).filter(Boolean);
  const val = (i) => (results[i].status === 'fulfilled' ? results[i].value : null);
  const [manatee, bra, digitized, uscgPoints, ramps] = [0, 1, 2, 3, 4].map(val);

  state.zones = normalizeAll([manatee, bra, digitized].filter(Boolean));
  state.uscgPoints = uscgPoints;
  state.ramps = ramps?.ramps || [];
  // Day/hour-dependent zones first (they change most often), then seasonal ones; Broward before Miami-Dade.
  const dayHour = (z) => (z.regimes.some((g) => g.when && (g.when.time || (g.when.days && g.when.days !== 'all'))) ? 0 : 1);
  state.timeDependent = state.zones.filter(isTimeDependent)
    .sort((a, b) => dayHour(a) - dayHour(b) || countyKey(a).localeCompare(countyKey(b)) || a.name.localeCompare(b.name));

  deriveSeasons();
  buildZoneLayers();
  renderUscgInfo();
  buildRamps();
  applyLayerVisibility();

  const st = $('load-status');
  const counts = ['manatee', 'bra', 'uscg'].map((l) => `${state.zones.filter((z) => z.layer === l).length} ${l}`).join(' · ');
  if (failed.length) {
    st.classList.add('error');
    st.textContent = `Could not load: ${failed.join(', ')}. Missing layers are NOT shown, so do not assume an area is unrestricted.`;
  } else {
    st.textContent = `${state.zones.length} zones (${counts}) · ${state.ramps.length} ramps in file. Click the map to check any spot.`;
  }
  refresh();
}

if (window.matchMedia('(max-width: 699px)').matches) setSheet(false);
load().catch((err) => {
  console.error(err);
  const st = $('load-status');
  st.classList.add('error');
  st.textContent = `Failed to start: ${err.message}`;
});

// Exposed for debugging / automated checks.
window.__pwc = { state, map, refresh, setMode, presetDate };
