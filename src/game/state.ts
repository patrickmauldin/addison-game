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

import { daysBetween, inSeasonWindow } from './calendar.js';

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
  inspector: {
    pay: number;
    strikes_today: number;
    reprimands: number;
    /**
     * Which street the inspector lives on, by id. Asked in the first briefing
     * and never again.
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

const KEY = 'addison.save.v1';

export function emptySave(): SaveFile {
  return {
    version: 1,
    inspector: { pay: 0, strikes_today: 0, reprimands: 0 },
    accuracy: {},
    addresses: {},
    days_completed: [],
  };
}

export function load(): SaveFile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as SaveFile;
    return parsed.version === 1 ? parsed : emptySave();
  } catch {
    return emptySave();
  }
}

export function save(s: SaveFile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private browsing; the slice runs fine without persistence across reloads */
  }
}

export function reset(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
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
};

export type DayContext = { iso: string; weekday: string };

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
  if (a.weekday_window?.includes(today.weekday)) return `Permitted on ${today.weekday}.`;
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
function articlesAlreadyCited(rec: AddressRecord): Set<string> {
  const out = new Set<string>();
  for (const r of rec.rulings) {
    if (r.verdict === 'PASS') continue;
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
  ctx: { today: DayContext; timing: Record<string, ArticleTiming>; rec: AddressRecord },
): LotOutcome {
  const nameOf = (id: string) => labels.get(id) ?? id;
  const kindOf = (id: string) => kinds.get(id) ?? nameOf(id);

  // Authored violations that are not violations TODAY, with the reason. They
  // become decoys for the round: marking one is a false positive, exactly as if
  // it had been authored clean, because on this date it IS clean.
  const excused = new Map<string, string>();
  const live = lot.truth.violations.filter((v) => {
    const why = excuse(v.article, v.object, ctx.timing, ctx.today, ctx.rec.first_seen);
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
    const cited = articlesAlreadyCited(ctx.rec);
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

  // A strike comes from the wrong verdict, or from any finding that would
  // survive appeal.
  const strike = !verdictRight || falsePositives.length > 0;

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
