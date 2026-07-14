#!/usr/bin/env node
/**
 * Design-system token codemod (Phase 3).
 *
 * Applies the deterministic, value-preserving (or explicitly-approved) class
 * replacements from docs/design-system.md across src/renderer .ts/.tsx.
 * Judgment-heavy remaps (long-tail near-black surfaces, component adoption)
 * are intentionally NOT automated here.
 *
 *   node scripts/style-codemod.mjs --dry    report per-rule hit counts, write nothing
 *   node scripts/style-codemod.mjs          apply and report
 *
 * Rules are applied in order; each is a [regex, replacement, label].
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "src", "renderer");

const RULES = [
    // --- Accent: identical color, zero visual change ---
    [/\[#40a8c4\]/g, "primary", "accent-hex → primary"],

    // --- Surface: EXACT canonical hex matches only (identical color) ---
    [/\[#0f1115\]/gi, "surface", "hex #0f1115 → surface"],
    [/\[#0b0d12\]/gi, "surface-sunken", "hex #0b0d12 → surface-sunken"],
    [/\[#05060a\]/gi, "surface-canvas", "hex #05060a → surface-canvas"],
    [/\[#1e1f22\]/gi, "surface-raised", "hex #1e1f22 → surface-raised"],
    [/\[#1e1e1e\]/gi, "surface-overlay", "hex #1e1e1e → surface-overlay"],
    [/\[#252525\]/gi, "surface-overlay", "hex #252525 → surface-overlay"],

    // --- Font size: approved single-tier merge (9/10/11px → 2xs) ---
    [/text-\[(?:9|10|11)px\]/g, "text-2xs", "text-[9/10/11px] → text-2xs"],

    // --- Text neutrals → fg ramp (dark-only app; shade convergence) ---
    [/\btext-(?:gray|slate)-(?:100|200)\b/g, "text-fg", "text gray/slate 100-200 → fg"],
    [/\btext-(?:gray|slate)-(?:300|400)\b/g, "text-fg-muted", "text gray/slate 300-400 → fg-muted"],
    [/\btext-(?:gray|slate)-(?:500|600)\b/g, "text-fg-subtle", "text gray/slate 500-600 → fg-subtle"],
    [/\bplaceholder-(?:gray|slate)-(?:300|400|500|600)\b/g, "placeholder-fg-subtle", "placeholder gray/slate → fg-subtle"],

    // --- Border white-alpha → edge (identical values) ---
    [/\bborder-white\/5\b/g, "border-edge-subtle", "border-white/5 → edge-subtle"],
    [/\bborder-white\/(?:10|15)\b/g, "border-edge", "border-white/10,15 → edge"],
    [/\bborder-white\/(?:20|25|30)\b/g, "border-edge-strong", "border-white/20,25,30 → edge-strong"],
    [/\bdivide-white\/5\b/g, "divide-edge-subtle", "divide-white/5 → edge-subtle"],
    [/\bdivide-white\/10\b/g, "divide-edge", "divide-white/10 → edge"],

    // --- Background white-alpha → fill (identical values) ---
    [/\bbg-white\/5\b/g, "bg-fill-subtle", "bg-white/5 → fill-subtle"],
    [/\bbg-white\/10\b/g, "bg-fill", "bg-white/10 → fill"],
    [/\bbg-white\/(?:15|20)\b/g, "bg-fill-strong", "bg-white/15,20 → fill-strong"],
    [/\bbg-white\/\[0\.0[1-5]\]/g, "bg-fill-subtle", "bg-white/[0.01-0.05] → fill-subtle"],
    [/\bbg-white\/\[0\.0[6-9]\]/g, "bg-fill", "bg-white/[0.06-0.09] → fill"],
];

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

const dry = process.argv.includes("--dry");
const hits = Object.fromEntries(RULES.map(([, , label]) => [label, 0]));
let filesChanged = 0;

for (const file of walk(SCAN_DIR)) {
    let src = readFileSync(file, "utf8");
    let changed = false;
    for (const [re, repl, label] of RULES) {
        const before = src;
        src = src.replace(re, (m) => {
            hits[label]++;
            return typeof repl === "string" ? repl : repl(m);
        });
        if (src !== before) changed = true;
    }
    if (changed) {
        filesChanged++;
        if (!dry) writeFileSync(file, src);
    }
}

console.log(`${dry ? "[dry-run] " : ""}Codemod hits per rule:`);
for (const [label, n] of Object.entries(hits)) console.log(`  ${String(n).padStart(4)}  ${label}`);
console.log(`\n${dry ? "Would change" : "Changed"} ${filesChanged} files.`);
