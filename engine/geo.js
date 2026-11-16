// Planar geometry helpers for GeoJSON Polygon / MultiPolygon in lon/lat.
const EARTH_R = 6371008.8;
const bboxCache = new WeakMap();

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(polygonsOf);
  return [];
}

/** [minLon, minLat, maxLon, maxLat], cached per geometry object. */
export function geometryBBox(geometry) {
  let b = bboxCache.get(geometry);
  if (b) return b;
  b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygonsOf(geometry)) {
    for (const [x, y] of poly[0] || []) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  }
  if (geometry && typeof geometry === 'object') bboxCache.set(geometry, b);
  return b;
}

export function bboxContains(b, [x, y]) {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ray casting; holes respected. */
export function pointInGeometry(point, geometry) {
  if (!bboxContains(geometryBBox(geometry), point)) return false;
  const [x, y] = point;
  for (const poly of polygonsOf(geometry)) {
    if (!poly.length || !inRing(poly[0], x, y)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(poly[h], x, y)) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Distance in meters from point to nearest polygon edge (local equirectangular). Ignores containment. */
export function distanceToEdgesM(point, geometry) {
  const [lon0, lat0] = point;
  const kx = Math.cos((lat0 * Math.PI) / 180) * (Math.PI / 180) * EARTH_R;
  const ky = (Math.PI / 180) * EARTH_R;
  let best = Infinity;
  for (const poly of polygonsOf(geometry)) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const d = segDist2(0, 0,
          (ring[i - 1][0] - lon0) * kx, (ring[i - 1][1] - lat0) * ky,
          (ring[i][0] - lon0) * kx, (ring[i][1] - lat0) * ky);
        if (d < best) best = d;
      }
    }
  }
  return Math.sqrt(best);
}

/** 0 when inside, else distance to edges in meters. */
export function distanceToGeometryM(point, geometry) {
  return pointInGeometry(point, geometry) ? 0 : distanceToEdgesM(point, geometry);
}

/** bbox expanded by `meters` around its edges (approximate, generous). */
export function expandBBox(b, meters) {
  const midLat = (b[1] + b[3]) / 2;
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}
