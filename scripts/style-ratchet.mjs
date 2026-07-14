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
 * Scans .ts/.tsx under src/renderer, excluding build output (dist/).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "src", "renderer");
const BASELINE = join(ROOT, "scripts", "style-ratchet.baseline.json");

const METRICS = {
    "arbitrary-hex": /\[#[0-9a-fA-F]{3,8}\]/g,
    "raw-neutral-palette": /\b(?:bg|text|border|ring|divide|from|via|to)-(?:gray|slate|zinc|neutral|stone)-\d/g,
    "raw-white-black-alpha": /\b(?:bg|text|border|ring|divide|shadow|from|via|to)-(?:white|black)\/\d/g,
    "arbitrary-px-font": /text-\[\d+px\]/g,
    "bare-or-arbitrary-rounded": /\brounded(?![-\w])|rounded-\[/g,
    "raw-accent": /#40a8c4|\b(?:bg|text|border|ring)-cyan-\d/gi,
};

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === "dist" || name === "node_modules") continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

function count() {
    const totals = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
    for (const file of walk(SCAN_DIR)) {
        const src = readFileSync(file, "utf8");
        for (const [key, re] of Object.entries(METRICS)) {
            const m = src.match(re);
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
