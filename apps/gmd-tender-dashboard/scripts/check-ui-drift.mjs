#!/usr/bin/env node
/**
 * UI drift ratchet.
 *
 * The app accumulated four parallel styling channels — Tailwind utilities,
 * ~6,600 lines of hand-written CSS, inline `style={{}}` and raw hex literals —
 * because nothing ever counted them. Two earlier consolidation attempts decayed
 * for the same reason.
 *
 * This script counts the things we are removing and fails if any count went up.
 * It never asks for zero; it only refuses to let a number grow. When you finish
 * a page migration the counts drop, and you run `--update` to lower the ratchet.
 *
 *   node scripts/check-ui-drift.mjs            # verify
 *   node scripts/check-ui-drift.mjs --update   # re-baseline after a migration
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "ui-drift-baseline.json");

const SCAN_DIRS = ["app", "components", "hooks", "lib"];
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "generated"]);

/** components/ui is the design system itself — it is allowed to use raw elements. */
const DESIGN_SYSTEM = `components${sep}ui${sep}`;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const tsx = files.filter((f) => f.endsWith(".tsx"));
const css = files.filter((f) => f.endsWith(".css"));

const read = (f) => readFileSync(f, "utf8");
const countMatches = (text, re) => (text.match(re) ?? []).length;

/** Count across files, optionally skipping the design system itself. */
function tally(re, { includeDesignSystem = false } = {}) {
  let total = 0;
  const byFile = [];
  for (const f of tsx) {
    const rel = relative(ROOT, f);
    if (!includeDesignSystem && rel.includes(DESIGN_SYSTEM)) continue;
    const n = countMatches(read(f), re);
    if (n > 0) {
      total += n;
      byFile.push([rel, n]);
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

const metrics = {
  // Raw elements that should be Button / Input / Select / MultiSelectFilter.
  rawButton: tally(/<button[\s>]/g),
  rawInput: tally(/<input[\s>]/g),
  rawSelect: tally(/<select[\s>]/g),
  // A fourth styling channel beside Tailwind, CSS classes and CSS files.
  inlineStyle: tally(/style=\{\{/g),
  // Colour that bypasses the token layer.
  arbitraryHex: tally(/\[#[0-9a-fA-F]{3,8}\]/g, { includeDesignSystem: true }),
  hexLiteral: tally(/#[0-9a-fA-F]{6}\b/g, { includeDesignSystem: true }),
  // Native browser dialogs instead of ConfirmDialog / toast. The `await`
  // lookbehind keeps the promise-based `await confirm({...})` from counting.
  nativeDialog: tally(/(?<!await )(?<![.\w])(?:window\.)?(?:confirm|alert)\s*\(/g),
  // Hand-rolled modal overlays instead of Dialog.
  handRolledOverlay: tally(/fixed inset-0/g),
  // The legacy stylesheet layer, in lines.
  legacyCssLines: {
    total: css.reduce((n, f) => n + read(f).split("\n").length, 0),
    byFile: css
      .map((f) => [relative(ROOT, f), read(f).split("\n").length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]),
  },
};

const current = Object.fromEntries(
  Object.entries(metrics).map(([k, v]) => [k, v.total]),
);

const shouldUpdate = process.argv.includes("--update");

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  baseline = null;
}

if (!baseline || shouldUpdate) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(
    baseline
      ? "UI drift baseline updated:"
      : "UI drift baseline created:",
  );
  for (const [k, v] of Object.entries(current)) {
    const was = baseline?.[k];
    const delta = was === undefined ? "" : `  (was ${was}, ${v - was >= 0 ? "+" : ""}${v - was})`;
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(6)}${delta}`);
  }
  process.exit(0);
}

const regressions = [];
for (const [key, value] of Object.entries(current)) {
  const limit = baseline[key];
  if (limit === undefined) continue;
  if (value > limit) regressions.push([key, limit, value]);
}

if (regressions.length === 0) {
  const improved = Object.entries(current).filter(
    ([k, v]) => baseline[k] !== undefined && v < baseline[k],
  );
  console.log("UI drift check passed.");
  for (const [k, v] of improved) {
    console.log(`  ${k}: ${baseline[k]} -> ${v}  (run --update to lock this in)`);
  }
  process.exit(0);
}

console.error("UI drift check failed - these counts went up:\n");
for (const [key, limit, value] of regressions) {
  console.error(`  ${key}: ${limit} -> ${value}  (+${value - limit})`);
  for (const [file, n] of metrics[key].byFile.slice(0, 5)) {
    console.error(`      ${n.toString().padStart(4)}  ${file}`);
  }
  console.error("");
}
console.error(
  "Use the primitives in components/ui instead. See AGENTS.md -> UI conventions.\n" +
    "If the increase is genuinely justified, run: node scripts/check-ui-drift.mjs --update",
);
process.exit(1);
