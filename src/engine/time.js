// Time helpers: wall-clock parts in a named IANA zone and the reverse mapping (DST-safe).
export const DEFAULT_TZ = 'America/New_York';

const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in `tz`. */
export function localParts(date, tz = DEFAULT_TZ) {
  const out = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type === 'weekday') out.dow = DOW[p.value];
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  let hour = out.hour === 24 ? 0 : out.hour;
  return {
    year: out.year, month: out.month, day: out.day, dow: out.dow,
    hour, minute: out.minute, second: out.second,
    minutes: hour * 60 + out.minute,
  };
}

/** Offset (ms) of tz from UTC at instant t: local wall time (as UTC) minus t. */
function offsetAt(t, tz) {
  const p = localParts(new Date(t), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * Wall clock in tz → instant. Iterates the offset guess so it is DST-safe.
 * Nonexistent times (spring-forward gap) resolve to the instant after the gap using the pre-transition offset;
 * ambiguous times (fall-back) resolve to the first (daylight) occurrence.
 */
export function zonedToDate({ year, month, day, hour = 0, minute = 0, second = 0 }, tz = DEFAULT_TZ) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let t = wall - offsetAt(wall, tz);
  let converged = false;
  for (let i = 0; i < 4; i++) {
    const next = wall - offsetAt(t, tz);
    if (next === t) { converged = true; break; }
    if (i === 3) break;
    t = next;
  }
  if (!converged) {
    // Spring-forward gap: the two offsets oscillate; take the later instant (just after the gap).
    t = Math.max(t, wall - offsetAt(t, tz));
  }
  // Ambiguous (fall-back): prefer the earlier instant if it also maps to the same wall time.
  const earlier = t - 3600_000;
  const pe = localParts(new Date(earlier), tz);
  if (pe.year === year && pe.month === month && pe.day === day && pe.hour === hour && pe.minute === minute) t = earlier;
  return new Date(t);
}

/** Calendar arithmetic on {year,month,day} (no time zone involved). */
export function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay() };
}

export function ymd({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
