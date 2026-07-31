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
  inspector: { pay: number; strikes_today: number; reprimands: number };
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
 * Scoring for verdict_mode "binary" (Days 1-4).
 *
 * Error weights follow gameplan section 5: a false positive takes a strike
 * because the association pays the appeal costs; a false negative is caught by
 * audit; a missed SECOND violation on a correctly-failed house is points only
 * this early, and does not become a strike until Day 15.
 */
export function adjudicate(
  lot: {
    lot_id: string;
    address: string;
    expected_verdict: string;
    truth: {
      violations: Array<{ object: string; article: string; why: string }>;
      decoys: Array<{ object: string; why: string }>;
    };
  },
  labels: Map<string, string>,
  flagged: Set<string>,
  stamped: Verdict,
  payPerInspection: number,
): LotOutcome {
  const violationIds = new Set(lot.truth.violations.map((v) => v.object));
  const nameOf = (id: string) => labels.get(id) ?? id;

  /**
   * ONE CITATION COVERS THE KIND.
   *
   * A lot with six weeds on it is one finding written six times, and making the
   * player click all six is a test of patience rather than of judgment. So
   * citing any one of them answers for the rest: what is being recorded is
   * "this lot has weeds", not an inventory.
   *
   * Grouped by LABEL rather than by article, and deliberately. The label is
   * what the player reads on the pad and what tells two objects apart — the
   * green bin and the brown bin are both R-104 but they are visibly two things,
   * and citing one should not silently answer for the other. Same key the
   * Findings pad groups on, so what the player is shown and what they are
   * marked against cannot disagree.
   */
  const citedKinds = new Set(
    lot.truth.violations.filter((v) => flagged.has(v.object)).map((v) => nameOf(v.object)),
  );

  // Hits stay the ones actually MARKED. The covered instances are not mistakes,
  // but they are not the player's work either.
  const hits = lot.truth.violations
    .filter((v) => flagged.has(v.object))
    .map((v) => ({ object: v.object, label: nameOf(v.object), article: v.article }));

  const missed = lot.truth.violations
    .filter((v) => !flagged.has(v.object) && !citedKinds.has(nameOf(v.object)))
    .map((v) => ({
      object: v.object,
      label: nameOf(v.object),
      article: v.article,
      why: v.why,
    }));

  const falsePositives = [...flagged]
    .filter((id) => !violationIds.has(id))
    .map((id) => ({
      object: id,
      label: labels.get(id) ?? id,
      why: lot.truth.decoys.find((d) => d.object === id)?.why ?? 'No violation of any active Article.',
    }));

  const expected = lot.expected_verdict as Verdict;
  /**
   * Correctness is about WHETHER the lot is clean, not how hard you hit it.
   *
   * Once there are three stamps, PASS / NOTICE / CITATION, a lot authored as
   * FAIL is answered correctly by either adverse stamp — a warning and a fine
   * are both "this lot is not compliant". Choosing the wrong SEVERITY is a
   * separate axis, and it only becomes a mistake when the escalation rules
   * arrive with the fines.
   */
  const adverse = (v: Verdict) => v !== 'PASS';
  const verdictRight = adverse(stamped) === adverse(expected);

  // A strike comes from an adverse verdict on a clean lot, from passing a
  // violating one, or from any finding that would survive appeal.
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
