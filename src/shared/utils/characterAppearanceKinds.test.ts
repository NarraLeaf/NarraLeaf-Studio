import { describe, expect, it } from "vitest";
import {
  CHARACTER_APPEARANCE_KINDS,
  PUPPET_APPEARANCE_KINDS,
  isCharacterAppearanceKind,
  isPuppetAppearanceKind,
  type CharacterAppearanceKind,
  type PuppetAppearanceKind
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
    const named = new Set(listKnownPuppetRuntimes().map((runtime) => runtime.id as string));
    expect(PUPPET_APPEARANCE_KINDS.filter((kind) => !named.has(kind))).toEqual(["puppet"]);
  });
});
