/**
 * Dummy tender rows for the /test flow-chart preview.
 *
 * Shaped to match exactly the fields computeFlowCounts reads. Note that
 * participatedDateRange initialises to { from: "2026-01-01" }, so every row
 * needs a deadline on or after that date or the whole chart reads zero.
 */

type Row = Record<string, unknown>;

const DEADLINE = "2026-03-15T00:00:00.000Z";

interface RowSpec {
  ra: boolean;
  /** Only meaningful when ra is true. */
  raComplete?: boolean;
  expectedRaDate?: boolean;
  status?: string;
  rank?: string;
  contract?: boolean;
  docketNo?: string;
}

let seq = 0;

function makeRow(spec: RowSpec): Row {
  seq += 1;
  return {
    id: `dummy-${seq}`,
    docketNo: spec.docketNo ?? `DKT-${String(seq).padStart(4, "0")}`,
    apm: "YES",
    participated: "true",
    deadline: DEADLINE,
    reverseAuctionApplicable: spec.ra ? "true" : "false",
    reverseAuctionStartDate:
      spec.ra && spec.raComplete ? "2026-02-01T00:00:00.000Z" : "",
    reverseAuctionEndDate:
      spec.ra && spec.raComplete ? "2026-02-02T00:00:00.000Z" : "",
    expectedRaDate: spec.expectedRaDate ? "2026-04-10T00:00:00.000Z" : "",
    currentStatus: spec.status ?? "",
    ourRank: spec.rank ?? "",
    contractNo: spec.contract ? `CON-${String(seq).padStart(4, "0")}` : "",
  };
}

function repeat(count: number, spec: RowSpec): Row[] {
  return Array.from({ length: count }, () => makeRow(spec));
}

/** Builds a row set that lands the given number in each leaf of the funnel. */
function build(counts: {
  raL1Contract: number;
  raL1Pending: number;
  raLost: number;
  raPendingWithDate: number;
  raPendingNoDate: number;
  finL1Contract: number;
  finL1Pending: number;
  finLost: number;
  finNotOpen: number;
  techNotOpen: number;
}): Row[] {
  return [
    // With RA -> RA Done -> We L1 -> Contract Received / Pending
    ...repeat(counts.raL1Contract, {
      ra: true,
      raComplete: true,
      rank: "1",
      contract: true,
    }),
    ...repeat(counts.raL1Pending, {
      ra: true,
      raComplete: true,
      rank: "1",
      contract: false,
    }),
    // With RA -> RA Done -> We Lost
    ...repeat(counts.raLost, { ra: true, raComplete: true, rank: "2" }),
    // With RA -> RA Pending (-> Exp RA Date)
    ...repeat(counts.raPendingWithDate, {
      ra: true,
      raComplete: false,
      expectedRaDate: true,
    }),
    ...repeat(counts.raPendingNoDate, { ra: true, raComplete: false }),
    // Without RA -> Technical Open -> Financial Open -> We L1 -> Contract
    ...repeat(counts.finL1Contract, {
      ra: false,
      status: "AWARDED",
      rank: "1",
      contract: true,
    }),
    ...repeat(counts.finL1Pending, {
      ra: false,
      status: "FINANCIAL EVALUATION",
      rank: "1",
      contract: false,
    }),
    // Without RA -> Technical Open -> Financial Open -> We Lost
    ...repeat(counts.finLost, { ra: false, status: "AWARDED", rank: "3" }),
    // Without RA -> Technical Open -> Financial Not Open
    ...repeat(counts.finNotOpen, {
      ra: false,
      status: "TECHNICAL BID OPENED",
      rank: "2",
    }),
    // Without RA -> Technical Not Open
    ...repeat(counts.techNotOpen, { ra: false, status: "NOT EVALUATED" }),
  ];
}

export interface Scenario {
  key: string;
  label: string;
  description: string;
  rows: Row[];
}

export const SCENARIOS: Scenario[] = [
  {
    key: "typical",
    label: "Typical",
    description: "Every branch populated with plausible volumes.",
    rows: build({
      raL1Contract: 12,
      raL1Pending: 19,
      raLost: 63,
      raPendingWithDate: 21,
      raPendingNoDate: 13,
      finL1Contract: 17,
      finL1Pending: 23,
      finLost: 50,
      finNotOpen: 60,
      techNotOpen: 60,
    }),
  },
  {
    key: "lopsided",
    label: "Lopsided",
    description:
      "Almost everything funnels into one leaf; several branches are zero.",
    rows: build({
      raL1Contract: 0,
      raL1Pending: 1,
      raLost: 2,
      raPendingWithDate: 0,
      raPendingNoDate: 0,
      finL1Contract: 0,
      finL1Pending: 0,
      finLost: 0,
      finNotOpen: 0,
      techNotOpen: 487,
    }),
  },
  {
    key: "large",
    label: "Large numbers",
    description: "Four-digit counts, to check number truncation and alignment.",
    rows: build({
      raL1Contract: 1204,
      raL1Pending: 987,
      raLost: 3310,
      raPendingWithDate: 1450,
      raPendingNoDate: 640,
      finL1Contract: 2201,
      finL1Pending: 1876,
      finLost: 4120,
      finNotOpen: 2988,
      techNotOpen: 3745,
    }),
  },
  {
    key: "sparse",
    label: "Sparse",
    description: "Single-digit counts with several empty leaves.",
    rows: build({
      raL1Contract: 1,
      raL1Pending: 0,
      raLost: 3,
      raPendingWithDate: 2,
      raPendingNoDate: 0,
      finL1Contract: 0,
      finL1Pending: 1,
      finLost: 4,
      finNotOpen: 0,
      techNotOpen: 2,
    }),
  },
  {
    key: "dockets",
    label: "Duplicate dockets",
    description:
      "30 rows sharing 3 docket numbers - dedupeByDocketNo should collapse them to 3.",
    rows: [
      ...repeat(10, {
        ra: true,
        raComplete: true,
        rank: "1",
        contract: true,
        docketNo: "DUP-A",
      }),
      ...repeat(10, {
        ra: true,
        raComplete: true,
        rank: "2",
        docketNo: "DUP-B",
      }),
      ...repeat(10, {
        ra: false,
        status: "AWARDED",
        rank: "1",
        docketNo: "DUP-C",
      }),
    ],
  },
  {
    key: "empty",
    label: "Empty",
    description: "No rows at all - the chart must not produce NaN geometry.",
    rows: [],
  },
];
