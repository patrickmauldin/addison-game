/**
 * PERSISTENCE — the file that makes gameplan section 6 work.
 *
 * A single save object keyed by lot_id. Houses carry state across dates; this
 * is what makes the game yours rather than a series of disconnected screens.
 *
 * Per-address state machine:
 *
 *   CLEAN ──violation appears──▶ FLAGGED ──notice issued──▶ ON_NOTICE
 *                                  │                            │
 *                                  │ missed                     ├─ fixed ──▶ CLEAN
 *                                  ▼                            ├─ unfixed ──▶ must CITATION
 *                              UNCAUGHT                         └─ 3x ──▶ LIEN
 *
 * Day 1 is binary PASS/FAIL and exercises none of the escalation edges. The
 * machine is here anyway because the manifest is right that it has to be
 * designed before content is authored against it — retrofitting escalation
 * onto a save format that never tracked first_seen is how this kind of project
 * ends up rewriting its content.
 */

import { daysBetween, inSeasonWindow, isCollectionWeek } from './calendar.js';

export type AddressState = 'CLEAN' | 'FLAGGED' | 'ON_NOTICE' | 'UNCAUGHT' | 'LIEN';
export type Verdict = 'PASS' | 'FAIL' | 'NOTICE' | 'CITATION';

export type Ruling = {
  day_id: number;
  date: string;
  verdict: Verdict;
  /** Object ids the inspector flagged, with the article cited for each. */
  findings: Array<{ object: string; article: string | null }>;
  /** Resolved after the audit, not at stamp time. Null until then. */
  correct: boolean | null;
};

export type AddressRecord = {
  lot_id: string;
  address: string;
  state: AddressState;
  /** Object id -> ISO date the inspector first recorded seeing it. The ONLY
   *  record of a grace-period start. Section 6: "the only record is your own note." */
  first_seen: Record<string, string>;
  rulings: Ruling[];
  escalations: number;
  /** Homeowner disposition, moved by wrongful citations. -2 hostile .. +2 warm. */
  disposition: number;
};

export type SaveFile = {
  version: 1;
  /**
   * Which shift this file is on, so resuming lands where the player stopped.
   *
   * It used to live nowhere: `levelIndex` was module state that began at 0 every
   * load, so a "continue" carried every address record forward and then put you
   * back on Shift 1 with them. Optional because a file written before slots
   * existed has no idea, and the only sane reading of that is the beginning.
   */
  level_id?: number;
  /** Real-world ms of the last write. What the slot list calls "played". */
  saved_at?: number;
  /** Real-world ms the slot was started. Fixes the order of the list. */
  created_at?: number;
  inspector: {
    pay: number;
    strikes_today: number;
    reprimands: number;
    /**
     * THE THIEF, who does not belong to a level.
     *
     * Every other bounty is settled on the round it appears. This one is only
     * out after dark and only for as long as the music runs, so missing him
     * does not end him — the notice stays up through the daylight rounds and he
     * is on the street again the next night. Which means his state cannot live
     * in a level file; it lives here, with everything else that outlasts a day.
     *
     * Absent means he has not been seen yet.
     */
    thief?: 'outstanding' | 'caught';
    /**
     * PAID mistakes per completed shift, oldest first.
     *
     * One mistake a shift is forgiven; the rest come out of the balance. Only
     * the last two entries are ever read — five deductions across two shifts is
     * a dismissal — but the whole run is kept because it costs nothing and it
     * is the only record of how a file ended up where it did.
     */
    deductions?: number[];
    /**
     * NOTICES STILL UP, by bounty id and oldest first.
     *
     * A flyer comes down when the thing on it is found, and not before. The
     * thief had this to himself in `thief` above; he only ever needed it
     * because he is the one who cannot be looked for on a daylight round, but
     * every other notice has the same problem in a smaller way — miss the cat
     * and the poster stays on the wall.
     *
     * Ids, not whole notices: the text and the reward live in the level file
     * that authored them, which is the one place they should be written.
     */
    outstanding?: string[];
    /**
     * The face a notice was drawn with, by bounty id.
     *
     * A wanted face is drawn per round rather than authored, so it cannot be
     * memorised. But a notice that stays up across rounds has to keep showing
     * the SAME man — the poster is a photograph, and a photograph does not
     * change because a week went by. Recorded the round it is first placed.
     */
    faces?: Record<string, number>;
    /**
     * What they put on the application, which is the only thing the Association
     * ever asks them about themselves.
     *
     * All optional: a save written before the form existed has none of it, and
     * the briefing degrades to the impersonal wording rather than printing
     * "undefined" at somebody.
     */
    name?: string;
    /** House number. Text, not a number — nobody validates an address here. */
    house?: string;
    /** Ticked boxes, by id. Nothing reads them yet. That is the joke. */
    quals?: string[];
    /**
     * Which street the inspector lives on, by id. Asked on the application and
     * never again.
     *
     * Optional because a save written before the question existed does not have
     * it, and because the player can walk past the dropdown without answering —
     * the manager is making conversation, not gating the round on it.
     */
    street?: string;
  };
  /** Accuracy per rule article, for the bi-weekly board review. */
  accuracy: Record<string, { right: number; wrong: number }>;
  addresses: Record<string, AddressRecord>;
  days_completed: number[];
};

/**
 * SLOTS.
 *
 * There used to be one file, overwritten forever, so "new game" and "the game"
 * were the same key and starting over destroyed what came before. Now every
 * new game takes a slot of its own and the old ones stay on the title screen.
 *
 * The index is a list of ids and nothing else — every slot's shift, its dates
 * and its inspector are read off the file itself, so there is exactly one place
 * a fact about a save is written and the list cannot drift from what it lists.
 */
/** The single file that existed before slots. Read once, on migration. */
const LEGACY_KEY = 'addison.save.v1';
const INDEX_KEY = 'addison.slots.v1';
/** Which slot the game is playing. Absent until the player picks one. */
const ACTIVE_KEY = 'addison.slot.v1';
const slotKey = (id: string) => `addison.save.v1.${id}`;

export type SlotInfo = {
  id: string;
  /** The shift the file stopped on. 1 for anything that never recorded one. */
  level_id: number;
  saved_at: number;
  created_at: number;
  /** What they put on the application, if they got that far. */
  name?: string;
};

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    /* private browsing; slots simply do not survive the session */
  }
}

function readSlot(id: string): SaveFile | null {
  try {
    const raw = localStorage.getItem(slotKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Adopt the pre-slots save, once.
 *
 * Somebody mid-campaign when this shipped must not lose it, and must not be
 * handed it as the active file either — the title screen is where a file gets
 * chosen now, so the migrated one is listed and waits to be picked like any
 * other. The legacy key is left where it is rather than deleted: it costs a few
 * kilobytes and it is the only copy if this goes wrong.
 */
function migrate(): void {
  try {
    if (localStorage.getItem(INDEX_KEY) !== null) return;
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      writeIndex([]);
      return;
    }
    const parsed = JSON.parse(raw) as SaveFile;
    if (parsed.version !== 1) {
      writeIndex([]);
      return;
    }
    const id = 'slot1';
    parsed.created_at ??= Date.now();
    parsed.saved_at ??= Date.now();
    localStorage.setItem(slotKey(id), JSON.stringify(parsed));
    writeIndex([id]);
  } catch {
    /* a storage that will not answer leaves the player with no slots, not a crash */
  }
}
migrate();

export function emptySave(): SaveFile {
  return {
    version: 1,
    level_id: 1,
    created_at: Date.now(),
    saved_at: Date.now(),
    inspector: { pay: 0, strikes_today: 0, reprimands: 0 },
    accuracy: {},
    addresses: {},
    days_completed: [],
  };
}

/** Every slot, newest first. A slot whose file will not parse is dropped. */
export function listSlots(): SlotInfo[] {
  return readIndex()
    .map((id): SlotInfo | null => {
      const f = readSlot(id);
      return f
        ? {
            id,
            level_id: f.level_id ?? 1,
            saved_at: f.saved_at ?? 0,
            created_at: f.created_at ?? 0,
            name: f.inspector.name,
          }
        : null;
    })
    .filter((s): s is SlotInfo => s !== null)
    .sort((a, b) => b.saved_at - a.saved_at);
}

export function activeSlot(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function activateSlot(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Start a fresh file and make it the one being played. Returns its id. */
export function newSlot(): string {
  // Wall-clock, not a counter: ids must not collide with a slot the index
  // failed to write, and they never need to be read by a human.
  const id = `slot${Date.now().toString(36)}`;
  const ids = readIndex();
  ids.push(id);
  writeIndex(ids);
  const file = emptySave();
  try {
    localStorage.setItem(slotKey(id), JSON.stringify(file));
  } catch {
    /* ignore */
  }
  activateSlot(id);
  return id;
}

export function deleteSlot(id: string): void {
  try {
    writeIndex(readIndex().filter((x) => x !== id));
    localStorage.removeItem(slotKey(id));
    if (activeSlot() === id) localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The file being played, or an empty one before a slot has been chosen.
 *
 * Boot calls this before the title screen has asked anything, which is why the
 * no-slot answer is a blank file rather than a throw: the module-scope
 * loadLevel only wants to know whether the thief is still out.
 */
export function load(): SaveFile {
  const id = activeSlot();
  return (id && readSlot(id)) || emptySave();
}

/** No active slot means nothing is written. Nothing is being played yet. */
export function save(s: SaveFile): void {
  const id = activeSlot();
  if (!id) return;
  s.saved_at = Date.now();
  try {
    localStorage.setItem(slotKey(id), JSON.stringify(s));
  } catch {
    /* private browsing; the slice runs fine without persistence across reloads */
  }
}

/** Throw away the file being played and go back to having none. */
export function reset(): void {
  const id = activeSlot();
  if (id) deleteSlot(id);
}

export function recordFor(s: SaveFile, lot_id: string, address: string): AddressRecord {
  let rec = s.addresses[lot_id];
  if (!rec) {
    rec = {
      lot_id,
      address,
      state: 'CLEAN',
      first_seen: {},
      rulings: [],
      escalations: 0,
      disposition: 0,
    };
    s.addresses[lot_id] = rec;
  }
  return rec;
}

/** Note an object's first sighting. Idempotent — the earliest date wins. */
export function noteFirstSeen(rec: AddressRecord, objectId: string, date: string): void {
  const prior = rec.first_seen[objectId];
  if (!prior || date < prior) rec.first_seen[objectId] = date;
}

export function bumpAccuracy(s: SaveFile, article: string, right: boolean): void {
  const a = (s.accuracy[article] ??= { right: 0, wrong: 0 });
  if (right) a.right++;
  else a.wrong++;
}

export function cumulativeAccuracy(s: SaveFile): number {
  let r = 0;
  let w = 0;
  for (const a of Object.values(s.accuracy)) {
    r += a.right;
    w += a.wrong;
  }
  return r + w === 0 ? 1 : r / (r + w);
}

// --- Adjudication ---------------------------------------------------------

export type LotOutcome = {
  lot_id: string;
  address: string;
  stamped: Verdict;
  expected: Verdict;
  verdictRight: boolean;
  /** Flagged a clean object. The worst error thematically: you were a bully. */
  falsePositives: Array<{ object: string; label: string; why: string }>;
  /** Real violation left unflagged. The audit finds it later: you were lazy. */
  missed: Array<{ object: string; label: string; article: string; why: string }>;
  hits: Array<{ object: string; label: string; article: string }>;
  strike: boolean;
  pay: number;
};

/**
 * WHEN an article bites. Three clocks, each its own field so nothing has to be
 * inferred from an id. See the note in rules.json.
 */
export type ArticleTiming = {
  weekday_window?: string[];
  season_window?: { from: string; to: string };
  grace_days?: number;
  /**
   * Collected every OTHER week, not every week.
   *
   * `week_of` is any date inside a collection week; the week containing it, and
   * every second week after and before it, is a collection week. Recycling is
   * the only thing in Addison on this schedule, and it is what makes the green
   * bin a different question from the brown one standing next to it.
   *
   * Rides ON TOP of `weekday_window` rather than replacing it: the container is
   * legal on Tuesday and Wednesday OF a collection week, which is two
   * conditions and not one.
   */
  alternate_weeks?: { week_of: string };
};

export type DayContext = { iso: string; weekday: string };

/**
 * A WAIVER, handed over on the doorstep.
 *
 * The Association does grant passes, and a homeowner who has one produces it
 * the moment you write the thing up. It is a piece of paper, so the question is
 * never "does this exist" but "is this real" — and the four ways it can be
 * wrong are the four things printed on it.
 *
 * VALIDITY IS DERIVED, never authored. A `valid: true` beside the artwork would
 * be two sources for one fact, and the day they disagree the game tells the
 * player they were wrong about something they read correctly.
 */
export type Pass = {
  id: string;
  lot_id: string;
  /** The prop it is produced over — the one the player just marked. */
  object: string;
  /** Asset key for the letterhead. Only ONE of them is the Association's. */
  letterhead: string;
  /** Asset key for the seal. Same. */
  stamp: string;
  /** The article it claims to excuse. Wrong article, wrong paper. */
  article: string;
  /** ISO date. On or after today is current; before today has run out. */
  expires: string;
  /** What the note says is covered, in the Association's own words. */
  covers: string;
  /** Who hands it over. */
  speaker: string;
};

/** The genuine article. Anything else on a pass is a forgery. */
export const REAL_LETTERHEAD = 'Letterhead/addison-letterhead1';
export const REAL_STAMP = 'Letterhead/hoa-stamp1';

/**
 * Why this pass is no good, or null if it is good.
 *
 * Checked in the order a person would look: the paper it is printed on, the
 * seal, what it says, then the date. The first failure is the one reported,
 * because that is the one the player should have seen.
 */
/**
 * Which of a lot's violations a GENUINE waiver covers today.
 *
 * One implementation, because three callers need the answer and they must not
 * differ: the game excuses these when it adjudicates, the simulator plays
 * against them, and the validator checks the authored verdict is the verdict a
 * careful player actually gets. A second copy is how the paper starts meaning
 * one thing on the desk and another in the audit.
 */
export function waivedBy(
  lot: { lot_id: string; truth: { violations: Array<{ object: string; article: string }> } },
  passes: Pass[] | undefined,
  todayIso: string,
): Set<string> {
  const out = new Set<string>();
  for (const p of passes ?? []) {
    if (p.lot_id !== lot.lot_id) continue;
    const article = lot.truth.violations.find((v) => v.object === p.object)?.article;
    if (article && !passFault(p, article, todayIso)) out.add(p.object);
  }
  return out;
}

export function passFault(p: Pass, article: string, todayIso: string): string | null {
  if (p.letterhead !== REAL_LETTERHEAD) return 'The letterhead is not the Association’s.';
  if (p.stamp !== REAL_STAMP) return 'The seal is not the Association’s.';
  if (p.article !== article) return `It excuses ${p.article}. This is a finding under ${article}.`;
  if (p.expires < todayIso) return `It expired on ${p.expires}.`;
  return null;
}

/**
 * Is this violation live TODAY, or is the thing it describes still legal?
 *
 * A bin at the curb on a Wednesday, lights up in December, a dumpster on its
 * third day — all three are authored as violations of their article and none of
 * them is a finding yet. Returns null when it bites, or the reason it does not.
 *
 * The grace clock runs from the player's OWN note. Section 6 of the gameplan is
 * emphatic that the Association keeps no record of when a container arrived, so
 * the date the inspector first wrote it down is the only date there is — which
 * also means a container the player has never inspected before starts its seven
 * days today, however long it has really been there. That is not a bug. It is
 * the reason the job is worth doing.
 */
function excuse(
  article: string,
  object: string,
  timing: Record<string, ArticleTiming>,
  today: DayContext,
  firstSeen: Record<string, string>,
): string | null {
  const a = timing[article];
  if (!a) return null;
  if (a.weekday_window?.includes(today.weekday)) {
    // Two conditions, not one: the right day OF the right week. A green bin on
    // a Tuesday is only compliant if that Tuesday is a collection Tuesday, and
    // the weeks in between are exactly what the player has to keep track of.
    if (a.alternate_weeks && !isCollectionWeek(today.iso, a.alternate_weeks.week_of)) return null;
    return `Permitted on ${today.weekday}.`;
  }
  if (a.season_window && inSeasonWindow(today.iso, a.season_window.from, a.season_window.to))
    return 'Inside the permitted season.';
  if (a.grace_days) {
    const seen = firstSeen[object];
    const n = seen ? daysBetween(seen, today.iso) : 0;
    if (n < a.grace_days)
      return `On record ${n} day${n === 1 ? '' : 's'}. The Article allows ${a.grace_days}.`;
  }
  return null;
}

/**
 * ONE WARNING, THEN A FINE — and the warning has to be one YOU issued.
 *
 * Escalation reads the player's own rulings at this address, not the level
 * file, so a violation they never wrote up is still a first offence next time
 * they come round. Miss the weeds on Monday and Wednesday is another warning;
 * the address does not remember what the inspector failed to notice.
 *
 * Per ARTICLE, not per address. Warning someone for weeds does not license a
 * fine for the bins you have never mentioned to them.
 */
/**
 * AND IT LAPSES. A citation counts for two weeks and then stops counting.
 *
 * Without a limit the file only ever grows: one warning in March licenses a
 * fine in December, and the case file becomes a list of things that will never
 * matter again sitting above the two that do. Fourteen days is the same window
 * the card greys a ruling out at, and it has to be the same number — the whole
 * point of striking a line through a ruling is that it no longer does anything.
 */
export const ESCALATION_DAYS = 14;

/** Is this ruling still live enough to turn a warning into a fine? */
export function rulingCounts(r: Ruling, todayIso: string): boolean {
  return r.verdict !== 'PASS'
    && r.findings.some((f) => f.article)
    && daysBetween(r.date, todayIso) <= ESCALATION_DAYS;
}

function articlesAlreadyCited(rec: AddressRecord, todayIso: string): Set<string> {
  const out = new Set<string>();
  for (const r of rec.rulings) {
    if (!rulingCounts(r, todayIso)) continue;
    for (const f of r.findings) if (f.article) out.add(f.article);
  }
  return out;
}

export function adjudicate(
  lot: {
    lot_id: string;
    address: string;
    truth: {
      violations: Array<{ object: string; article: string; why: string }>;
      decoys: Array<{ object: string; why: string }>;
    };
  },
  labels: Map<string, string>,
  /** Object id to finding KIND — `group ?? label`. See PropSpec.group. */
  kinds: Map<string, string>,
  flagged: Set<string>,
  stamped: Verdict,
  payPerInspection: number,
  ctx: {
    today: DayContext;
    timing: Record<string, ArticleTiming>;
    rec: AddressRecord;
    /** Object ids covered by a pass that turned out to be genuine. */
    waived?: Set<string>;
  },
): LotOutcome {
  const nameOf = (id: string) => labels.get(id) ?? id;
  const kindOf = (id: string) => kinds.get(id) ?? nameOf(id);

  // Authored violations that are not violations TODAY, with the reason. They
  // become decoys for the round: marking one is a false positive, exactly as if
  // it had been authored clean, because on this date it IS clean.
  const excused = new Map<string, string>();
  const live = lot.truth.violations.filter((v) => {
    // A GENUINE PASS IS AN EXCUSE LIKE ANY OTHER. The Association has already
    // said this one is allowed, so it is not a finding today — and writing it
    // up anyway is a false positive, exactly as it is for a dumpster inside its
    // seven days. A forged pass excuses nothing and never reaches this set.
    const why = ctx.waived?.has(v.object)
      ? 'A current Association pass covers it. The homeowner produced it.'
      : excuse(v.article, v.object, ctx.timing, ctx.today, ctx.rec.first_seen);
    if (why) excused.set(v.object, why);
    return !why;
  });
  const liveIds = new Set(live.map((v) => v.object));

  /**
   * ONE CITATION COVERS THE KIND.
   *
   * A lot with six weeds on it is one finding written six times, and making the
   * player click all six is a test of patience rather than of judgment. So
   * citing any one of them answers for the rest: what is being recorded is
   * "this lot has weeds", not an inventory.
   *
   * Grouped by KIND rather than by article, and deliberately. An article is too
   * coarse: R-107 covers a sofa and a washing machine alike, and finding one of
   * those should not quietly answer for the other sitting in plain sight.
   *
   * Kind is the label unless a prop says otherwise. The green bin and the brown
   * bin carry their colour in the label so the audit can say which one it means,
   * but they share a group — bins at the curb are one finding however many
   * wheels are involved. Same key the Findings pad counts on, so what the player
   * is shown and what they are marked against cannot disagree.
   */
  const citedKinds = new Set(live.filter((v) => flagged.has(v.object)).map((v) => kindOf(v.object)));

  // Hits stay the ones actually MARKED. The covered instances are not mistakes,
  // but they are not the player's work either.
  const hits = live
    .filter((v) => flagged.has(v.object))
    .map((v) => ({ object: v.object, label: nameOf(v.object), article: v.article }));

  const missed = live
    .filter((v) => !flagged.has(v.object) && !citedKinds.has(kindOf(v.object)))
    .map((v) => ({
      object: v.object,
      label: nameOf(v.object),
      article: v.article,
      why: v.why,
    }));

  const falsePositives = [...flagged]
    .filter((id) => !liveIds.has(id))
    .map((id) => ({
      object: id,
      label: nameOf(id),
      why:
        excused.get(id)
        ?? lot.truth.decoys.find((d) => d.object === id)?.why
        ?? 'No violation of any active Article.',
    }));

  /**
   * The verdict is COMPUTED, not authored.
   *
   * It has to be. Whether this lot earns a fine depends on what the player did
   * here last time, and a level file written in advance cannot know that. What
   * the file authors is what is WRONG with the lot; the date decides which of
   * those count today, and the address's own history decides how hard.
   */
  const repeat = live.length > 0 && (() => {
    const cited = articlesAlreadyCited(ctx.rec, ctx.today.iso);
    return live.some((v) => cited.has(v.article));
  })();
  const expected: Verdict = live.length === 0 ? 'PASS' : repeat ? 'CITATION' : 'NOTICE';

  /**
   * SEVERITY COUNTS, now that there is a severity to get wrong.
   *
   * It did not use to: with two stamps, any adverse mark answered a bad lot.
   * With three, choosing between them IS the judgment — one warning before a
   * fine is the rule the player is being taught, and a fine written straight
   * off is the same failure as a warning written on a repeat. The address's
   * ruling history is on the case file, so this is a thing they can look up
   * rather than a thing they have to have memorised.
   */
  const verdictRight = stamped === expected;

  /**
   * A strike comes from the wrong verdict, from a finding that would survive
   * appeal, or from a violation left unwritten.
   *
   * The third of those is new, and it closes the hole the other two left: the
   * verdict is computed from what is WRONG with the lot rather than from what
   * the player marked, so stamping WARNING at a house you never looked at was
   * scored exactly the same as stamping it after finding the weeds. The whole
   * job was skippable by guessing severities.
   *
   * `missed` is already one entry per KIND — citing one weed answers for the
   * other five — so this asks for one of each violation on the lot and not an
   * inventory of it.
   */
  const strike = !verdictRight || falsePositives.length > 0 || missed.length > 0;

  return {
    lot_id: lot.lot_id,
    address: lot.address,
    stamped,
    expected,
    verdictRight,
    falsePositives,
    missed,
    hits,
    strike,
    pay: payPerInspection,
  };
}
