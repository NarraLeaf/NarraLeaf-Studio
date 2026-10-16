import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
    CHARACTER_APPEARANCE_KINDS,
    PUPPET_APPEARANCE_KINDS,
    isCharacterAppearanceKind,
    isPuppetAppearanceKind,
    type CharacterAppearanceKind,
    type PuppetAppearanceKind,
} from "./characterAppearanceKinds";
import { KNOWN_PUPPET_RUNTIME_IDS, listKnownPuppetRuntimes } from "./puppetRuntimes";

/**
 * The guard the source cannot express.
 *
 * `CHARACTER_APPEARANCE_KINDS` is declared `satisfies readonly CharacterAppearanceKind[]`, which
 * rejects a member that is not on the union and — structurally — accepts a list that is *missing*
 * one, because a shorter array satisfies the same constraint. That gap is not cosmetic: a kind on the
 * union but off the list is read as the pre-rework store and the author's appearance is **deleted**,
 * in two independent loaders (`CharacterAppearance`'s constructor and `migrateCharacterStore`).
 *
 * Assigning the union *to* the list's element type closes it. Every member of
 * `CharacterAppearanceKind` must be assignable to some literal in the list, so adding a kind without
 * listing it fails `tsc` here rather than eating data at runtime. `src/shared/tsconfig.json` includes
 * every `.ts` file under it, test files included, so `yarn lint` runs this.
 */
type ListedKind = (typeof CHARACTER_APPEARANCE_KINDS)[number];
type ListedPuppetKind = (typeof PUPPET_APPEARANCE_KINDS)[number];
const EVERY_KIND_IS_LISTED: ListedKind = null as unknown as CharacterAppearanceKind;
const EVERY_PUPPET_KIND_IS_LISTED: ListedPuppetKind = null as unknown as PuppetAppearanceKind;

describe("character appearance kinds", () => {
    it("lists every kind exactly once", () => {
        expect([...CHARACTER_APPEARANCE_KINDS]).toEqual([...new Set(CHARACTER_APPEARANCE_KINDS)]);
        expect([...PUPPET_APPEARANCE_KINDS]).toEqual([...new Set(PUPPET_APPEARANCE_KINDS)]);
    });

    it("keeps the type-level exhaustiveness guards referenced", () => {
        // The two consts above are the real assertions and are checked by `tsc`, not by vitest.
        // Reading them here is what stops a linter or a future cleanup from deleting them as unused.
        expect([EVERY_KIND_IS_LISTED, EVERY_PUPPET_KIND_IS_LISTED]).toHaveLength(2);
    });

    it("treats every puppet kind as a character kind", () => {
        for (const kind of PUPPET_APPEARANCE_KINDS) {
            expect(isPuppetAppearanceKind(kind)).toBe(true);
            expect(isCharacterAppearanceKind(kind)).toBe(true);
            expect(CHARACTER_APPEARANCE_KINDS).toContain(kind);
        }
    });

    it("does not treat the kinds Studio draws itself as puppets", () => {
        for (const kind of ["preset", "layered"] as const) {
            expect(isCharacterAppearanceKind(kind)).toBe(true);
            expect(isPuppetAppearanceKind(kind)).toBe(false);
        }
    });

    it("rejects anything else, including the shapes a malformed store holds", () => {
        for (const value of ["", "Preset", "live2D", "puppet ", null, undefined, 0, {}, ["puppet"]]) {
            expect(isCharacterAppearanceKind(value)).toBe(false);
            expect(isPuppetAppearanceKind(value)).toBe(false);
        }
    });

    /**
     * The two lists are deliberately not derived from one another (see `PuppetAppearanceKind`), so
     * this is what keeps them in step: naming a runtime in the registry without adding its kind would
     * put a product in the creation menu whose characters cannot be stored.
     */
    it("has an appearance kind for every runtime it names", () => {
        for (const id of KNOWN_PUPPET_RUNTIME_IDS) {
            expect(isPuppetAppearanceKind(id)).toBe(true);
        }
    });

    it("names a runtime for every puppet kind except the custom one", () => {
        const named = new Set(listKnownPuppetRuntimes().map(runtime => runtime.id as string));
        expect(PUPPET_APPEARANCE_KINDS.filter(kind => !named.has(kind))).toEqual(["puppet"]);
    });
});

/**
 * Nothing asks a character "are you a puppet?" by comparing its kind to the string `"puppet"`.
 *
 * `getKind()` answers `live2d` or `spine` for the two runtimes Studio knows by name, and `puppet`
 * only for a runtime the author wrote. A comparison with the one literal therefore reads as the
 * puppet check and quietly leaves out every Live2D and Spine character. It shipped that way in five
 * places at once: the scene editor never asked a Live2D model for its motions, so `/motion` offered
 * none, and the inspector told the author her character was drawn by Studio. Ask
 * `isPuppetAppearanceKind(getKind())`, or `getPuppet()` when the declaration itself is wanted.
 *
 * Only `getKind()` is watched. A summary's `kind` (`DevModeCharacterSummary`) really is `"puppet"`
 * for all three - `characterSummaries` collapses them on purpose - so comparing that one is right.
 */
describe("puppet kind checks", () => {
    const SRC = path.resolve(__dirname, "../..");
    const COMPARES_KIND_TO_PUPPET = /getKind\(\)\s*[!=]==?\s*["'`]puppet["'`]|["'`]puppet["'`]\s*[!=]==?\s*[\w.?]*getKind\(\)/;

    function sources(dir: string, out: string[] = []): string[] {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== "dist") {
                    sources(full, out);
                }
            } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                out.push(full);
            }
        }
        return out;
    }

    function withoutComments(source: string): string {
        return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    }

    it("never compares an appearance kind to the literal \"puppet\"", () => {
        const files = sources(SRC);
        // A walk that found nothing would pass by looking at nothing.
        expect(files.length).toBeGreaterThan(1000);
        const offenders = files
            .filter(file => COMPARES_KIND_TO_PUPPET.test(withoutComments(fs.readFileSync(file, "utf-8"))))
            .map(file => path.relative(SRC, file).replaceAll(path.sep, "/"));
        expect(offenders).toEqual([]);
    });

    it("would catch the shapes it is there for", () => {
        for (const line of [
            `character.profile.appearance.getKind() === "puppet"`,
            `appearance.getKind() !== 'puppet'`,
            `"puppet" === appearance?.getKind()`,
        ]) {
            expect(COMPARES_KIND_TO_PUPPET.test(line)).toBe(true);
        }
        expect(COMPARES_KIND_TO_PUPPET.test(`isPuppetAppearanceKind(appearance.getKind())`)).toBe(false);
        expect(COMPARES_KIND_TO_PUPPET.test(`summary.appearance.kind === "puppet"`)).toBe(false);
    });
});
