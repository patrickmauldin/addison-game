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
 * 1 March 2027 is genuinely a Monday, which is what makes Level 1 a Monday
 * without the stored date lying.
 */

const START = { y: 2027, m: 3, d: 1 };
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
