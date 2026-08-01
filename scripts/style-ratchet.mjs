#!/usr/bin/env node
/**
 * Style debt ratchet.
 *
 * Counts hard-coded styling patterns that the design-system consolidation
 * (docs/design-system.md) is retiring, and fails if any count rises above the
 * committed baseline. Counts may only go DOWN.
 *
 *   yarn style:ratchet          compare current counts against the baseline
 *   yarn style:ratchet --save   write current counts as the new baseline
 *
 * Scans the string literals of .ts/.tsx under src/renderer, excluding build
 * output (dist/), tests, comment bodies, and identifiers — see
 * scripts/style-scan.mjs for why each of those is out.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { METRICS, walk, readCode } from "./style-scan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "src", "renderer");
const BASELINE = join(ROOT, "scripts", "style-ratchet.baseline.json");

function count() {
    const totals = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
    for (const file of walk(SCAN_DIR)) {
        const { styles } = readCode(file);
        for (const [key, re] of Object.entries(METRICS)) {
            const m = styles.match(re);
            if (m) totals[key] += m.length;
        }
    }
    return totals;
}

const current = count();
const save = process.argv.includes("--save");

if (save) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    console.log("Saved style-ratchet baseline:");
    for (const [k, v] of Object.entries(current)) console.log(`  ${k}: ${v}`);
    process.exit(0);
}

if (!existsSync(BASELINE)) {
    console.error(`No baseline found at ${relative(ROOT, BASELINE)}. Run: yarn style:ratchet --save`);
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
let failed = false;
console.log("Style debt (current / baseline):");
for (const key of Object.keys(METRICS)) {
    const cur = current[key] ?? 0;
    const base = baseline[key] ?? 0;
    const delta = cur - base;
    const mark = delta > 0 ? "  ✗ UP" : delta < 0 ? "  ✓ down" : "";
    console.log(`  ${key}: ${cur} / ${base}${delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}${mark}`);
    if (delta > 0) failed = true;
}

if (failed) {
    console.error("\nStyle debt increased above baseline. Use design-system tokens (docs/design-system.md).");
    console.error("If a rise is unavoidable, justify it and run `yarn style:ratchet --save` to reset the baseline.");
    process.exit(1);
}
console.log("\nOK — no style debt increase.");
