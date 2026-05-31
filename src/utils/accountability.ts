// ─────────────────────────────────────────────────────────────────────────────
// Accountability scorecard data
//
// The homepage counter ("how many prosecuted / faced consequences / are in jail")
// is computed from THIS list — every headline number is backed by a named person
// here, so the counts are auditable and easy to keep honest.
//
// Scope is deliberately NARROW: count only people named in the Epstein files for
// their connection to HIM — associates, friends, clients, enablers — who have faced a
// real, verified consequence: a criminal charge, imprisonment, or the loss of a job or
// formal title (a resignation, a firing, or being stripped of a title). Intangible or
// reputational hits — a lost honor, charity patronage, board seat, or public standing —
// do NOT count. Two groups are also deliberately EXCLUDED:
//   • officials whose job consequences stem from investigating, prosecuting, or
//     handling the case (e.g. a fired Attorney General, a resigned plea-deal prosecutor);
//   • people who merely appear in the files — being named is not a consequence.
// To change what the counters show, edit this list — add/remove a person and the
// totals follow.
//
// Flags (a person can carry several — the buckets are not mutually exclusive):
//   charged    — formally charged with a crime (includes those later convicted)
//   convicted  — criminally convicted
//   arrested   — arrested / under criminal investigation but not (yet) charged
//   imprisoned — currently incarcerated in connection with the case
//   lostRole   — lost a job or a formal title (resigned, was fired, or was stripped of a title)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountabilityOutcome {
  name: string;
  slug?: string; // people/<slug> profile id, if one exists (link rendered only when it does)
  year: number;
  charged?: boolean;
  convicted?: boolean;
  arrested?: boolean;
  imprisoned?: boolean;
  lostRole?: boolean;
  consequence: string; // short headline label, e.g. "Fired as U.S. Attorney General"
  detail: string; // one-sentence explanation
}

export const OUTCOMES: AccountabilityOutcome[] = [
  // ── Criminal: charged / convicted / imprisoned ──────────────────────────────
  {
    name: 'Ghislaine Maxwell',
    slug: 'ghislaine-maxwell',
    year: 2021,
    charged: true,
    convicted: true,
    imprisoned: true,
    consequence: 'Convicted; serving 20 years',
    detail: 'Convicted of sex trafficking in 2021 and serving a 20-year federal sentence — the only person currently imprisoned in connection with the case.',
  },
  {
    name: 'Jeffrey Epstein',
    slug: 'jeffrey-epstein',
    year: 2019,
    charged: true,
    convicted: true,
    consequence: 'Convicted (2008); died in custody',
    detail: 'Convicted on state charges in 2008 and indicted on federal sex-trafficking charges in 2019; died in custody before he could be tried.',
  },
  {
    name: 'Jean-Luc Brunel',
    slug: 'jean-luc-brunel',
    year: 2020,
    charged: true,
    consequence: 'Charged; died in custody',
    detail: 'French modeling agent and Epstein associate charged in France with trafficking and rape of minors; died in custody in 2022 before trial.',
  },

  // ── Arrested in 2026, under investigation (not charged) ─────────────────────
  {
    name: 'Andrew Mountbatten-Windsor',
    slug: 'prince-andrew',
    year: 2026,
    arrested: true,
    lostRole: true,
    consequence: 'Arrested; stripped of "Prince" title',
    detail: 'Former Prince Andrew was arrested in 2026 on suspicion of misconduct in public office and released under investigation; he had already been stripped of his "Prince" and "Royal Highness" styles and given up the use of the Duke of York title.',
  },
  {
    name: 'Peter Mandelson',
    slug: 'peter-mandelson',
    year: 2026,
    arrested: true,
    lostRole: true,
    consequence: 'Arrested; sacked as ambassador',
    detail: 'Former U.K. ambassador to the U.S. arrested in 2026 on suspicion of misconduct in public office and released on bail; he had been sacked as ambassador in 2025.',
  },

  // ── Lost a job or a formal title (named in the files; not officials) ────────
  {
    name: 'Leon Black',
    slug: 'leon-black',
    year: 2021,
    lostRole: true,
    consequence: 'Resigned as Apollo CEO',
    detail: 'Stepped down as CEO of Apollo Global Management in 2021 after a review of the roughly $158 million he paid Epstein for advice.',
  },
  {
    name: 'Jes Staley',
    slug: 'jes-staley',
    year: 2021,
    lostRole: true,
    consequence: 'Resigned as Barclays CEO',
    detail: 'Resigned as CEO of Barclays in 2021 over regulators’ findings about how he had characterized his relationship with Epstein; later banned from senior U.K. finance roles.',
  },
];

// Contextual constant: the central accountability gap. The DOJ has charged no new
// co-conspirators since it began releasing the files (House Judiciary testimony, 2026).
export const NEW_CHARGES_SINCE_RELEASE = 0;

export interface Scorecard {
  prosecuted: number; // criminally charged (incl. convicted)
  imprisoned: number; // currently incarcerated
  lostRole: number; // lost a job or a formal title (resigned, fired, or stripped of a title)
  arrested: number; // arrested & under investigation, not yet charged
  newChargesSinceRelease: number;
}

export function getScorecard(): Scorecard {
  return {
    prosecuted: OUTCOMES.filter((o) => o.charged).length,
    imprisoned: OUTCOMES.filter((o) => o.imprisoned).length,
    lostRole: OUTCOMES.filter((o) => o.lostRole).length,
    arrested: OUTCOMES.filter((o) => o.arrested && !o.charged).length,
    newChargesSinceRelease: NEW_CHARGES_SINCE_RELEASE,
  };
}
