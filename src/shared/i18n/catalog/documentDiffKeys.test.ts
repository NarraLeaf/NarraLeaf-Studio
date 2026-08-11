import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROJECT_DOCUMENT_SPECS } from "@shared/documents/specs";
import { flattenCatalog } from "../flatten";
import { en } from "./en";
import { zh } from "./zh";

/**
 * Every `documentDiff.*` key a producer emits must exist in BOTH catalogues.
 *
 * This is the one gap `parity.test.ts` cannot see. That test compares en against zh, so a key
 * missing from BOTH passes it - and these keys are missing from both by construction, because
 * nothing but a producer ever writes them: a spec's `diff` hands back a translation key as a plain
 * string (the diff model is shared with the main process, which has no business importing a
 * renderer's key union), so no `satisfies`, no `TranslationKey` cast and no `tsc` run has an opinion
 * about whether the string names anything. The failure is silent and total: the change list draws
 * `documentDiff.characters.layerAsset` at the author and nothing anywhere reports it.
 *
 * It happened once, at the scale this guards: milestone D4 landed three `spec.diff` implementations
 * whose 55 label keys were never added to either catalogue.
 *
 * Enumerated from the SOURCE rather than by running the diffs, deliberately. A fixture-driven check
 * only covers the branches its fixtures reach - which is exactly the labels nobody thought about -
 * and a check over exported `LABEL` maps would not see a new spec that never exports one. Reading
 * the files catches every key any producer can name, including in specs that do not exist yet.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../..");

/** Where a `documentDiff.*` label key can be written. Directories, walked for `.ts` / `.tsx`. */
const PRODUCER_DIRS = [
    "shared/documents",
    "main/app/application/managers/vcs",
    "renderer/lib/vcs",
    // The comparison tab and the merge panel. Not producers of label keys, but the same failure
    // reaches the author from here: a `documentDiff.*` string these write renders as itself, and
    // `tsc` has no opinion about it either, because `t()` takes a key union that a hand-written
    // dotted string satisfies only if it is right.
    "renderer/apps/workspace/modules/vcs-changes",
];

/**
 * Keys a producer builds by concatenation, so the literal in the source is a prefix and not a key.
 *
 * Both are resolved through `translator.has()` with a documented fallback to the raw identifier, so
 * a missing one degrades to `audioTracks` rather than to a dotted path. The completions are still
 * required below - `count.*` through every registered spec's `summarize`.
 */
const DYNAMIC_PREFIXES = ["documentDiff.count.", "documentDiff.structural."];

function walk(dir: string, out: string[] = []): string[] {
    const abs = path.join(SRC, dir);
    if (!fs.existsSync(abs)) {
        return out;
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            walk(rel, out);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            // Tests are skipped: they name keys that are deliberately absent, to prove an unknown
            // producer key renders as itself rather than as nothing.
            out.push(rel);
        }
    }
    return out;
}

const PRODUCER_FILES = PRODUCER_DIRS.flatMap((dir) => walk(dir));
const sourceOf = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf-8");

/** `key -> where it is written`, over quoted `documentDiff.…` literals outside comments. */
function emittedLabelKeys(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const rel of PRODUCER_FILES) {
        const lines = sourceOf(rel).split(/\r?\n/);
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            // Prose in this area quotes keys illustratively; a comment emits nothing.
            if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
                return;
            }
            for (const match of line.matchAll(/["'`](documentDiff\.[A-Za-z0-9_.]*)["'`]/g)) {
                const key = match[1];
                if (DYNAMIC_PREFIXES.includes(key)) {
                    continue;
                }
                found.set(key, [...(found.get(key) ?? []), `src/${rel}:${index + 1}`]);
            }
        });
    }
    return found;
}

/**
 * `documentDiff.count.<key>` for every count a spec's `summarize` names.
 *
 * Both ways round, because neither alone is sound. Read from the source, which sees a count a spec
 * only reports for a document no fixture here holds; AND run, which sees one built from a variable
 * rather than written as a literal. `summarize` is handed an empty object and allowed to throw -
 * `summarize` is explicitly NOT on the no-throw contract that `diff` is (see `documentDiff.ts`,
 * which guards it), and at least one spec indexes a field `parse` guarantees and `{}` lacks.
 */
function emittedCountKeys(text: (rel: string) => string, files: string[]): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const add = (key: string, where: string): void => {
        const full = `documentDiff.count.${key}`;
        const seen = found.get(full) ?? [];
        found.set(full, seen.includes(where) ? seen : [...seen, where]);
    };

    for (const rel of files) {
        for (const block of text(rel).matchAll(/counts:\s*\[([\s\S]*?)\]/g)) {
            for (const entry of block[1].matchAll(/key:\s*"([A-Za-z0-9_]+)"/g)) {
                add(entry[1], `src/${rel}`);
            }
        }
    }
    for (const spec of PROJECT_DOCUMENT_SPECS) {
        try {
            for (const count of spec.summarize({} as never).counts) {
                add(count.key, `the ${spec.kind} spec's summarize`);
            }
        } catch {
            // Covered by the source scan above; a spec that cannot summarize `{}` is not a finding.
        }
    }
    return found;
}

const enKeys = new Set(flattenCatalog(en).keys());
const zhKeys = new Set(flattenCatalog(zh).keys());

/**
 * Whether a key a producer wrote resolves to text in this catalogue.
 *
 * A key passed to `tn()` names the BASE of a plural pair, so the catalogue holds `<key>.one` and
 * `<key>.other` and never `<key>` itself. Without this, every pluralised line in a scanned file
 * would be reported as missing from both catalogues - a false positive that would be silenced by
 * un-pluralising the copy, which is the opposite of what this test is protecting.
 */
function resolves(keys: ReadonlySet<string>, key: string): boolean {
    return keys.has(key) || keys.has(`${key}.other`);
}

describe("documentDiff producer keys", () => {
    const emitted = new Map([...emittedLabelKeys(), ...emittedCountKeys(sourceOf, PRODUCER_FILES)]);

    it("finds the producers at all", () => {
        // Guards the vacuous pass: a moved directory or a tightened pattern would empty the map and
        // make every assertion below trivially hold, which is the shape of the bug this test is for.
        expect(emitted.size).toBeGreaterThan(60);
        expect([...emitted.keys()]).toContain("documentDiff.characters.layerAsset");
        expect([...emitted.keys()]).toContain("documentDiff.count.storyScenes");
    });

    for (const [locale, keys] of [["en", enKeys], ["zh", zhKeys]] as const) {
        it(`translates every key a producer emits in ${locale}`, () => {
            const missing = [...emitted.keys()].filter((key) => !resolves(keys, key)).sort();

            expect(
                missing,
                `${locale} is missing ${missing.length} key(s) that a diff producer emits. Nothing else\n` +
                    `will catch this - the change list renders the dotted key at the author and no test,\n` +
                    `type or lint fails. Add them to src/shared/i18n/catalog/${locale}/documentDiff.ts:\n` +
                    missing.map((key) => `  ${key}    (${emitted.get(key)!.join(", ")})`).join("\n") +
                    "\n",
            ).toEqual([]);
        });
    }
});
