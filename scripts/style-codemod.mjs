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
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { styleLiterals, walk } from "./style-scan.mjs";

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

    // White-alpha surfaces can be deliberately theme-invariant; they need context, not a rewrite.
];

const dry = process.argv.includes("--dry");
const hits = Object.fromEntries(RULES.map(([, , label]) => [label, 0]));
let filesChanged = 0;

for (const file of walk(SCAN_DIR)) {
    let src = readFileSync(file, "utf8");
    let styles = styleLiterals(src, file);
    let changed = false;
    for (const [re, repl, label] of RULES) {
        // The mask preserves offsets, so matches can be applied to the original text without
        // touching comments or code that is not a string literal.
        const matches = [...styles.matchAll(re)];
        for (const match of matches.reverse()) {
            const replacement = typeof repl === "string" ? repl : repl(match[0]);
            src = src.slice(0, match.index) + replacement + src.slice(match.index + match[0].length);
            styles = styles.slice(0, match.index) + replacement + styles.slice(match.index + match[0].length);
        }
        hits[label] += matches.length;
        if (matches.length > 0) changed = true;
    }
    if (changed) {
        filesChanged++;
        if (!dry) writeFileSync(file, src);
    }
}

console.log(`${dry ? "[dry-run] " : ""}Codemod hits per rule:`);
for (const [label, n] of Object.entries(hits)) console.log(`  ${String(n).padStart(4)}  ${label}`);
console.log(`\n${dry ? "Would change" : "Changed"} ${filesChanged} files.`);
