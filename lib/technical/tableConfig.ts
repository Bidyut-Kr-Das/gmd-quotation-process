/**
 * Schema for the five Engineering Data tables.
 *
 * Each tab mirrors one tab of the source spreadsheet
 * ("GMD Technical Master Data"), identified by its gid. The column captions
 * below are the sheet's own header text, with runs of whitespace collapsed and
 * trimmed — the sheet contains double spaces, a leading space, and embedded
 * newlines (`"Mech.\nAdvantage  ±10%"`), none of which render meaningfully in a
 * table cell.
 *
 * `columns` is index-aligned with each fetched row array, so the order here is
 * load-bearing. The captions are declared in code rather than read from the
 * sheet so the two `Duration` columns on GATE VALVE can be disambiguated
 * (`Duration (Body)` / `Duration (Seat)`) and so every tab has unique captions —
 * the table keys its filters by caption, so uniqueness matters.
 */

export type EngineeringTab = {
  /** Stable slug, used as the `?tab=` value, the API path, and a React key. */
  key: string;
  /** Caption shown on the subtab. */
  label: string;
  /** One-line description shown under the title bar. */
  description: string;
  /** Tab title in the source spreadsheet. */
  sheetName: string;
  /** Tab gid, for deep links back into the sheet. */
  gid: number;
  /**
   * A1-notation range covering the **data rows only** — the header row and any
   * preamble rows are excluded here, because `columns` already supplies the
   * captions.
   */
  dataRange: string;
  /** Column captions, in order. Indexes match the row arrays. */
  columns: string[];
  /** Captions rendered right-aligned in a tabular-nums face. */
  numericColumns: ReadonlySet<string>;
  /** Captions rendered as a status pill rather than plain text. */
  statusColumns: ReadonlySet<string>;
  /** Per-column default width in px, keyed by caption. */
  defaultColumnWidths?: Record<string, number>;
  /** Word-wrap captions and values onto as many lines as they need. */
  wrapCells?: boolean;
  /**
   * Kept in the sync (its data is written to the DB) but omitted from the
   * subtab bar. Used for DENSITY, whose values are referenced by the other tabs
   * rather than browsed directly.
   */
  hiddenInUi?: boolean;
};

/* -------------------------------------------------------------------------- */
/* GATE VALVE — gid 531982553, headers in row 1, columns A..T                  */
/* -------------------------------------------------------------------------- */

const GATE_VALVE_COLUMNS = [
  "SIZE (mm)",
  "PN Rating/ CLASS",
  "DIA OF BONNET (MIN)",
  "DIA OF BONNET (MAX)",
  "HEIGHT OF BONNET(MM)",
  "Face-to-Face Length (mm)",
  "Face-to-Face Length Tolarence (± mm)",
  "Flange OD (mm)",
  "Flange OD (±mm)Tolerance",
  "PCD (mm)",
  "PCD (± mm) Tolerance",
  "Number of Bolts",
  "Bolt Diameter (mm)",
  "Source",
  "Material",
  "Body PRESSURE",
  // The sheet heads both of these "Duration". One is the body test duration, the
  // other the seat test duration; rendered identically they would be impossible
  // to tell apart and would share a single filter.
  "Duration (Body)",
  "Seat PRESSURE",
  "Duration (Seat)",
  "Approx weight (kg)",
];

const GATE_VALVE_NUMERIC = new Set([
  "SIZE (mm)",
  "PN Rating/ CLASS",
  "DIA OF BONNET (MIN)",
  "DIA OF BONNET (MAX)",
  "HEIGHT OF BONNET(MM)",
  "Face-to-Face Length (mm)",
  "Face-to-Face Length Tolarence (± mm)",
  "Flange OD (mm)",
  "Flange OD (±mm)Tolerance",
  "PCD (mm)",
  "PCD (± mm) Tolerance",
  "Number of Bolts",
  "Bolt Diameter (mm)",
  "Body PRESSURE",
  "Duration (Body)",
  "Seat PRESSURE",
  "Duration (Seat)",
  "Approx weight (kg)",
]);

/* -------------------------------------------------------------------------- */
/* FLANGE — gid 0, header in row 2 (row 1 is a column-order map), A..Y         */
/* -------------------------------------------------------------------------- */

const FLANGE_COLUMNS = [
  "SIZE",
  "MOC",
  "PN RATING/ CLASS",
  "WALL THICKNESS (MM)",
  "ID (MM)",
  "ID (±MM)",
  "OD (MM)",
  "OD TOLERANCE (+ MM)",
  "OD TOLERANCE (- MM)",
  "PCD (mm)",
  "PCD TOLERANCE (± MM)",
  "NO OF HOLE (NOS)",
  "HOLE DIA",
  "HOLE DIA TOLERANCE (+ MM)",
  "HOLE DIA TOLERANCE (- MM)",
  "THICKNESS of flange",
  "THICKNESS TOLERANCE (+ MM)",
  "THICKNESS TOLERANCE (- MM)",
  "RAISED FACE THICKNESS of flange",
  "RAISED FACE THICKNESS TOLERANCE (+ MM)",
  "RAISED FACE THICKNESS TOLERANCE (- MM)",
  "SEAT PRESSURE",
  "BODY PRESSURE",
  "STANDARDS",
  "FLANGE TYPE",
];

const FLANGE_NUMERIC = new Set([
  "SIZE",
  "PN RATING/ CLASS",
  "WALL THICKNESS (MM)",
  "ID (MM)",
  "ID (±MM)",
  "OD (MM)",
  "OD TOLERANCE (+ MM)",
  "OD TOLERANCE (- MM)",
  "PCD (mm)",
  "PCD TOLERANCE (± MM)",
  "NO OF HOLE (NOS)",
  "HOLE DIA",
  "HOLE DIA TOLERANCE (+ MM)",
  "HOLE DIA TOLERANCE (- MM)",
  "THICKNESS of flange",
  "THICKNESS TOLERANCE (+ MM)",
  "THICKNESS TOLERANCE (- MM)",
  "RAISED FACE THICKNESS of flange",
  "RAISED FACE THICKNESS TOLERANCE (+ MM)",
  "RAISED FACE THICKNESS TOLERANCE (- MM)",
  "SEAT PRESSURE",
  "BODY PRESSURE",
]);

/* -------------------------------------------------------------------------- */
/* GEAR BOX — gid 1266518282, headers in row 1, columns C..AG                  */
/* -------------------------------------------------------------------------- */

const GEAR_BOX_COLUMNS = [
  "type of valve",
  "size of valve",
  "pn rating",
  "torque of valve",
  "torque with safety factor",
  "TURNS TO CLOSE VALVES",
  "STD",
  "PCD",
  "shaft length",
  "shaft dia/STEM DIA",
  "size of base",
  "BORE DIA",
  "DRILLING DIMENSION",
  "GEAR BOX TYPE",
  "NM REQD RANGE",
  "RM CODE",
  "APPROVED",
  "REQD BASE",
  "gearbox serial no EMERSON",
  "gearbox serial no VIRAL",
  "gear box output torque",
  "Turns To Close",
  "Mech. Advantage ±10%",
  "Ratio",
  "Max Drive Bore",
  "WEIGHT",
  "Recommended Handwheel (mm)",
  "Gearbox price EMERSON",
  "GEARBOX VIRAL",
  "ACTUATOR MODEL NO",
  "ACTUATOR RPM",
];

const GEAR_BOX_NUMERIC = new Set([
  "size of valve",
  "torque of valve",
  "torque with safety factor",
  "TURNS TO CLOSE VALVES",
  "PCD",
  "shaft length",
  "BORE DIA",
  "gear box output torque",
  "Turns To Close",
  "Mech. Advantage ±10%",
  "Ratio",
  "Max Drive Bore",
  "WEIGHT",
  "Gearbox price EMERSON",
  "ACTUATOR RPM",
]);

/* -------------------------------------------------------------------------- */
/* ACUATOR-MODEL NO — gid 962975923, headers in row 1, columns A..N            */
/* -------------------------------------------------------------------------- */

const ACTUATOR_COLUMNS = [
  "Model",
  "Speed",
  "Rated TQ",
  "Size",
  "Poles",
  "LRT Current in A",
  "Rated TQ Current in A",
  "Avg Load Current in A",
  "Nominal kW",
  "Power Factor",
  "Efficiency",
  "OLR set",
  "with inching duty",
  "without inching duty",
];

const ACTUATOR_NUMERIC = new Set([
  "Speed",
  "Rated TQ",
  "Poles",
  "LRT Current in A",
  "Rated TQ Current in A",
  "Avg Load Current in A",
  "Nominal kW",
  "Power Factor",
  "Efficiency",
  "OLR set",
]);

/* -------------------------------------------------------------------------- */
/* DENSITY — gid 166133048, headers in row 1, columns A..B                     */
/* -------------------------------------------------------------------------- */

const DENSITY_COLUMNS = ["MATERIAL", "DENSITY(GM/CM^3)"];

const DENSITY_NUMERIC = new Set(["DENSITY(GM/CM^3)"]);

const EMPTY_STATUS = new Set<string>();

/* -------------------------------------------------------------------------- */

export const ENGINEERING_TABS: EngineeringTab[] = [
  {
    key: "gate-valve",
    label: "Gate Valve",
    description:
      "Gate valve dimensional and pressure-test data by size and rating class.",
    sheetName: "GATE VALVE",
    gid: 531982553,
    dataRange: "A2:T",
    columns: GATE_VALVE_COLUMNS,
    numericColumns: GATE_VALVE_NUMERIC,
    statusColumns: EMPTY_STATUS,
    defaultColumnWidths: {
      "Face-to-Face Length Tolarence (± mm)": 150,
      Source: 110,
      Material: 100,
      "Approx weight (kg)": 130,
    },
    wrapCells: true,
  },
  {
    key: "flange",
    label: "Flange",
    description:
      "Flange dimensions, tolerances and test pressures by size, MOC and standard.",
    sheetName: "FLANGE",
    gid: 0,
    dataRange: "A3:Y",
    columns: FLANGE_COLUMNS,
    numericColumns: FLANGE_NUMERIC,
    statusColumns: EMPTY_STATUS,
    defaultColumnWidths: {
      STANDARDS: 180,
      "FLANGE TYPE": 130,
      "RAISED FACE THICKNESS of flange": 180,
      "RAISED FACE THICKNESS TOLERANCE (+ MM)": 190,
      "RAISED FACE THICKNESS TOLERANCE (- MM)": 190,
    },
    wrapCells: true,
  },
  {
    key: "gear-box",
    label: "Gear Box",
    description:
      "Worm gear box selection by valve, with torque, mounting dimensions and pricing.",
    sheetName: "GEAR BOX",
    gid: 1266518282,
    // Columns A and B hold data but carry no header, so the table starts at C.
    dataRange: "C2:AG",
    columns: GEAR_BOX_COLUMNS,
    numericColumns: GEAR_BOX_NUMERIC,
    statusColumns: EMPTY_STATUS,
    defaultColumnWidths: {
      "type of valve": 120,
      "RM CODE": 130,
      "gearbox serial no EMERSON": 170,
      "gearbox serial no VIRAL": 160,
      "Recommended Handwheel (mm)": 170,
      "Gearbox price EMERSON": 150,
      "ACTUATOR MODEL NO": 160,
    },
    wrapCells: true,
  },
  {
    key: "actuator",
    label: "Actuator",
    description:
      "Actuator model electrical data: speed, torque, motor current and protection settings.",
    sheetName: "ACUATOR-MODEL NO",
    gid: 962975923,
    dataRange: "A2:N",
    columns: ACTUATOR_COLUMNS,
    numericColumns: ACTUATOR_NUMERIC,
    statusColumns: EMPTY_STATUS,
    defaultColumnWidths: {
      Model: 120,
      Size: 130,
      "LRT Current in A": 140,
      "Rated TQ Current in A": 160,
      "Avg Load Current in A": 160,
      "with inching duty": 150,
      "without inching duty": 170,
    },
    wrapCells: true,
  },
  {
    key: "density",
    label: "Density",
    description: "Material densities used for weight and costing calculations.",
    sheetName: "DENSITY",
    gid: 166133048,
    dataRange: "A2:B",
    columns: DENSITY_COLUMNS,
    numericColumns: DENSITY_NUMERIC,
    statusColumns: EMPTY_STATUS,
    defaultColumnWidths: {
      MATERIAL: 260,
      "DENSITY(GM/CM^3)": 180,
    },
    hiddenInUi: true,
  },
];

export const DEFAULT_TAB_KEY = ENGINEERING_TABS[0].key;

/** The tabs rendered in the subtab bar — every tab except the hidden ones. */
export const VISIBLE_TABS: EngineeringTab[] = ENGINEERING_TABS.filter(
  (tab) => !tab.hiddenInUi,
);

/** Looks a tab up by key across **all** tabs, hidden included. */
export function findTab(
  key: string | null | undefined,
): EngineeringTab | undefined {
  return ENGINEERING_TABS.find((tab) => tab.key === key);
}

/** Resolves a `?tab=` value to a known *visible* tab, falling back to the first. */
export function resolveTab(key: string | null | undefined): EngineeringTab {
  return (
    VISIBLE_TABS.find((tab) => tab.key === key) ??
    VISIBLE_TABS.find((tab) => tab.key === DEFAULT_TAB_KEY)!
  );
}
