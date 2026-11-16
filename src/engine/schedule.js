// Seasonal date ranges and time windows.
import { isFloridaHoliday } from './holidays.js';

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'NOV 15 - MAR 31' -> {start:[11,15], end:[3,31]} (inclusive, may wrap the year). null if unparseable. */
export function parseDateRange(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().toUpperCase().match(/^([A-Z]{3})[A-Z]*\.?\s*(\d{1,2})\s*[-–—]\s*([A-Z]{3})[A-Z]*\.?\s*(\d{1,2})$/);
  if (!m) return null;
  const sm = MONTHS[m[1]], em = MONTHS[m[3]];
  if (!sm || !em) return null;
  return { start: [sm, Number(m[2])], end: [em, Number(m[4])] };
}

export function isAllYear(range) {
  return !range || (range.start[0] === 1 && range.start[1] === 1 && range.end[0] === 12 && range.end[1] === 31);
}

export function formatDateRange(range) {
  if (isAllYear(range)) return 'All year';
  return `${MONTH_NAMES[range.start[0]]} ${range.start[1]} – ${MONTH_NAMES[range.end[0]]} ${range.end[1]}`;
}

/** Inclusive, wrap-around aware. */
export function inSeason(range, { month, day }) {
  if (!range) return true;
  const v = month * 100 + day;
  const s = range.start[0] * 100 + range.start[1];
  const e = range.end[0] * 100 + range.end[1];
  return s <= e ? v >= s && v <= e : v >= s || v <= e;
}

export function hhmmToMinutes(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Start inclusive, end exclusive, on local minutes since midnight. Wraps midnight if start > end. */
export function inTimeWindow(time, minutes) {
  if (!time) return true;
  const s = hhmmToMinutes(time.start), e = hhmmToMinutes(time.end);
  if (s === e) return true;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** parts: {year, month, day, dow, minutes} (from localParts). */
export function matchesWhen(when, parts) {
  if (!when) return true;
  if (when.season) {
    const range = typeof when.season === 'string' ? parseDateRange(when.season) : when.season;
    if (!inSeason(range, parts)) return false;
  }
  const days = when.days || 'all';
  if (days !== 'all') {
    const weekendOrHoliday = parts.dow === 0 || parts.dow === 6 || !!isFloridaHoliday(parts);
    if (days === 'weekend_holiday' && !weekendOrHoliday) return false;
    if (days === 'weekday_nonholiday' && weekendOrHoliday) return false;
  }
  if (when.time && !inTimeWindow(when.time, parts.minutes ?? parts.hour * 60 + parts.minute)) return false;
  return true;
}

export function describeWhen(when) {
  if (!when) return 'At all times';
  const bits = [];
  if (when.season) {
    const r = typeof when.season === 'string' ? parseDateRange(when.season) : when.season;
    bits.push(formatDateRange(r));
  }
  if (when.days === 'weekend_holiday') bits.push('Sat, Sun & FL holidays');
  if (when.days === 'weekday_nonholiday') bits.push('weekdays (non-holiday)');
  if (when.time) bits.push(`${when.time.start}–${when.time.end}`);
  return bits.length ? bits.join(', ') : 'At all times';
}
