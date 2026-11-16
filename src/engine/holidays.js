// Florida legal holidays, § 110.117(1), F.S. Both actual and observed dates are returned/treated as holidays.
import { ymd } from './time.js';

const dowOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function nthWeekday(y, m, dow, n) {
  const first = dowOf(y, m, 1);
  return 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y, m, dow) {
  const last = daysInMonth(y, m);
  return last - ((dowOf(y, m, last) - dow + 7) % 7);
}

function actualHolidays(y) {
  const tg = nthWeekday(y, 11, 4, 4);
  return [
    { y, m: 1, d: 1, name: "New Year's Day" },
    { y, m: 1, d: nthWeekday(y, 1, 1, 3), name: 'Martin Luther King, Jr., Day' },
    { y, m: 5, d: lastWeekday(y, 5, 1), name: 'Memorial Day' },
    { y, m: 7, d: 4, name: 'Independence Day' },
    { y, m: 9, d: nthWeekday(y, 9, 1, 1), name: 'Labor Day' },
    { y, m: 11, d: 11, name: "Veterans' Day" },
    { y, m: 11, d: tg, name: 'Thanksgiving Day' },
    { y, m: 11, d: tg + 1, name: 'Friday after Thanksgiving' },
    { y, m: 12, d: 25, name: 'Christmas Day' },
  ];
}

const cache = new Map();

/** [{date:'YYYY-MM-DD', name, observed}] for dates falling within `year` (incl. observed dates shifted in from y±1). */
export function floridaHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const out = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const h of actualHolidays(y)) {
      if (y === year) out.push({ date: ymd({ year: y, month: h.m, day: h.d }), name: h.name, observed: false });
      const dow = dowOf(y, h.m, h.d);
      if (dow === 6 || dow === 0) {
        const o = new Date(Date.UTC(y, h.m - 1, h.d + (dow === 6 ? -1 : 1)));
        if (o.getUTCFullYear() === year) {
          out.push({
            date: ymd({ year, month: o.getUTCMonth() + 1, day: o.getUTCDate() }),
            name: `${h.name} (observed)`,
            observed: true,
          });
        }
      }
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.observed - b.observed));
  cache.set(year, out);
  return out;
}

/** null | {name, observed}; actual date wins over an observed entry on the same day. */
export function isFloridaHoliday({ year, month, day }) {
  const key = ymd({ year, month, day });
  const hit = floridaHolidays(year).find((h) => h.date === key);
  return hit ? { name: hit.name, observed: hit.observed } : null;
}
