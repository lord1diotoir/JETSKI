// Holiday lists. Both actual and observed dates (Sat -> preceding Fri, Sun -> following Mon) count as holidays.
//  - 'FS_110_117'      § 110.117(1), F.S. (default; used for the 68C manatee weekend/holiday zone).
//  - 'FAC_68D_24_002'  Rule 68D-24.002(5), F.A.C., which governs 68D boating restricted areas. Same list plus Columbus Day.
//  - 'ANY'             union of both (for display).
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

export const HOLIDAY_SETS = ['FS_110_117', 'FAC_68D_24_002', 'ANY'];
export const DEFAULT_HOLIDAY_SET = 'FS_110_117';

function actualHolidays(y, set) {
  const tg = nthWeekday(y, 11, 4, 4);
  const list = [
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
  if (set === 'FAC_68D_24_002' || set === 'ANY') {
    list.push({ y, m: 10, d: nthWeekday(y, 10, 1, 2), name: 'Columbus Day', only: 'FAC_68D_24_002' });
  }
  return list;
}

const cache = new Map();

/** [{date:'YYYY-MM-DD', name, observed}] for dates falling within `year` (incl. observed dates shifted in from y±1). */
export function floridaHolidays(year, set = DEFAULT_HOLIDAY_SET) {
  if (!HOLIDAY_SETS.includes(set)) throw new Error(`Unknown holiday set ${set}`);
  const ck = `${set}:${year}`;
  if (cache.has(ck)) return cache.get(ck);
  const out = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const h of actualHolidays(y, set)) {
      if (y === year) out.push({ date: ymd({ year: y, month: h.m, day: h.d }), name: h.name, observed: false, ...(h.only ? { only: h.only } : {}) });
      const dow = dowOf(y, h.m, h.d);
      if (dow === 6 || dow === 0) {
        const o = new Date(Date.UTC(y, h.m - 1, h.d + (dow === 6 ? -1 : 1)));
        if (o.getUTCFullYear() === year) {
          out.push({
            date: ymd({ year, month: o.getUTCMonth() + 1, day: o.getUTCDate() }),
            name: `${h.name} (observed)`,
            observed: true,
            ...(h.only ? { only: h.only } : {}),
          });
        }
      }
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.observed - b.observed));
  cache.set(ck, out);
  return out;
}

/** null | {name, observed}; actual date wins over an observed entry on the same day. */
export function isFloridaHoliday({ year, month, day }, set = DEFAULT_HOLIDAY_SET) {
  const key = ymd({ year, month, day });
  const hit = floridaHolidays(year, set).find((h) => h.date === key);
  return hit ? { name: hit.name, observed: hit.observed, ...(hit.only ? { only: hit.only } : {}) } : null;
}
