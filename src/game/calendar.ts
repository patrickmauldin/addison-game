/**
 * The campaign calendar.
 *
 * Levels are two days apart, not one. Two reasons, and both matter:
 *
 *  - Trash day comes round in three levels rather than seven, so the bins rule
 *    can be taught, tested and then punished without a week of filler between.
 *  - Stepping two days through a seven-day week walks every weekday in seven
 *    levels — Mon, Wed, Fri, Sun, Tue, Thu, Sat — so no day is unreachable and
 *    none repeats until the cycle closes.
 *
 * The date is DERIVED from the level number rather than authored per level. An
 * authored date and an authored weekday can contradict each other, and a rule
 * that turns on the day of the week cannot afford that.
 *
 * 2 March 2026 is genuinely a Monday, which is what makes Level 1 a Monday
 * without the stored date lying.
 *
 * THE DAY IS PICKED BY THE WEEKDAY, not by the number. Moving the campaign from
 * 2027 to 2026 could not keep 1 March, because that is a Sunday in 2026 — every
 * shift would have slid one weekday and R-104 would have put the bins out on
 * the wrong days for the whole game. The 2nd is the nearest Monday, so the
 * authored `first_seen` dates all moved a day with it.
 */

const START = { y: 2026, m: 3, d: 2 };
const DAYS_PER_LEVEL = 2;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type LevelDate = { iso: string; weekday: string; label: string };

/** Level 1 is the start date; every level after is two days on. */
export function dateForLevel(level: number): LevelDate {
  // UTC throughout: a local-time Date shifts the day across a timezone boundary,
  // and the weekday is load-bearing for R-104.
  const t = Date.UTC(START.y, START.m - 1, START.d) + (level - 1) * DAYS_PER_LEVEL * 86400000;
  const d = new Date(t);
  const iso = d.toISOString().slice(0, 10);
  return {
    iso,
    weekday: WEEKDAYS[d.getUTCDay()],
    // "Mar 3" — the year is stored so dates sort and grace periods can be
    // measured, but showing it would date a fictional community for no gain.
    label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
  };
}

/**
 * Bins may be at the curb on Tuesday and Wednesday. Any other day is a finding.
 *
 * Collection is Wednesday; the day either side is the window for putting them
 * out and taking them in. Deliberately a whole-day rule rather than the hour
 * boundaries a real declaration would use — the player cannot see a clock, and
 * a rule you cannot check is not a rule, it is a coin toss.
 */
export function binsAllowed(weekday: string): boolean {
  return weekday === 'Tuesday' || weekday === 'Wednesday';
}

/** Whole days from `a` to `b`, both ISO. Negative if b precedes a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** The Monday on or before an ISO date, as a UTC millisecond stamp. */
function weekStart(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  // getUTCDay is 0 for Sunday, so Sunday belongs to the week that began six
  // days earlier rather than to the one starting tomorrow.
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return t - back * 86400000;
}

/**
 * Is `iso` in a collection week, counting in twos from the week of `ref`?
 *
 * Recycling runs on alternate weeks. Whole WEEKS, not days: the answer has to
 * be the same for every day of a given week, or the bin would be collectable on
 * Tuesday and not on Wednesday. Weeks run Monday to Sunday, which is also how
 * the campaign's shifts fall — Shift 4 is a Sunday and belongs with the three
 * shifts before it, not with the week that starts the next morning.
 *
 * Symmetric about `ref`: the modulo is taken on the absolute difference so a
 * date before the reference week answers the same as its mirror after it.
 */
export function isCollectionWeek(iso: string, ref: string): boolean {
  const weeks = Math.abs(weekStart(iso) - weekStart(ref)) / (7 * 86400000);
  return weeks % 2 === 0;
}

/**
 * Is this date inside a MM-DD window?
 *
 * Wraps the year end, which is the only reason this is not a comparison. The
 * seasonal-lighting window runs 1 November to 31 January, so "inside" is
 * `>= from OR <= to` for that one and `>= from AND <= to` for a window that
 * stays within a year. Getting this backwards would make lights legal for ten
 * months and a violation for two.
 */
export function inSeasonWindow(iso: string, from: string, to: string): boolean {
  const md = iso.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
