import { describe, expect, it, vi } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import { planShippedCharacters } from "./gameRuntimeArtifactCompiler";

/**
 * Which characters a variant carries.
 *
 * This was the last hole in "a demo does not carry the rest of the game": the cast list names every
 * portrait and pose a character has, so a character only the dropped chapters speak as kept their
 * whole wardrobe in the package - and their name, in every language.
 *
 * The ordering claim is the one worth pinning. The cast is narrowed *before* the asset sweep runs,
 * which is why these assertions are about the cast rather than about the assets: get the order wrong
 * and the asset sweep has already seen the dropped character's sheet.
 */

const REN = "11111111-1111-4111-8111-111111111111";
const TRAITOR = "22222222-2222-4222-8222-222222222222";

function bundle(overrides: Partial<DevModeBundle> = {}): DevModeBundle {
  return {
    storyLibrary: {
      index: { stories: [] },
      documents: {},
      characters: [
        { id: REN, name: "Ren", appearance: { kind: "none" } },
        { id: TRAITOR, name: "The Traitor", appearance: { kind: "none" } }
      ],
      assetNames: {}
    },
    ...overrides
  } as unknown as DevModeBundle;
}

describe("planShippedCharacters", () => {
  it("drops a character no shipped byte names", () => {
    const notices: string[] = [];
    const result = planShippedCharacters(
      bundle({
        storyLibrary: {
          ...bundle().storyLibrary!,
          documents: { s1: { line: `speaks as ${REN}` } }
        } as never
      }),
      null,
      (message) => notices.push(message)
    );

    expect(result.characterIds).toEqual(new Set([REN]));
    expect(result.bundle.storyLibrary?.characters.map((character) => character.id)).toEqual([REN]);
    expect(notices).toContain("1 characters are unreachable in this edition and do not ship");
  });

  it("does not let the name table vote for its own character", () => {
    // Every `char:` unit id *is* a character id, so a sweep that read the localization table
    // would keep the whole cast on the strength of the table that lists it.
    const result = planShippedCharacters(
      bundle({
        storyLibrary: {
          ...bundle().storyLibrary!,
          documents: { s1: { line: `speaks as ${REN}` } }
        } as never,
        localization: {
          sourceLocale: "en",
          locales: ["en"],
          tables: { en: { [`char:${REN}`]: "Ren", [`char:${TRAITOR}`]: "The Traitor" } }
        } as never
      }),
      null
    );

    expect(result.characterIds).toEqual(new Set([REN]));
    expect(result.bundle.localization?.tables.en).toEqual({ [`char:${REN}`]: "Ren" });
  });

  it("keeps a character a plugin catalogue names", () => {
    const result = planShippedCharacters(
      bundle({ storyLibrary: { ...bundle().storyLibrary!, documents: {} } as never }),
      [{ cast: [REN, TRAITOR] }]
    );

    expect(result.characterIds).toEqual(new Set([REN, TRAITOR]));
  });

  it("changes nothing when the whole cast is reachable", () => {
    const input = bundle({
      storyLibrary: {
        ...bundle().storyLibrary!,
        documents: { s1: { a: REN, b: TRAITOR } }
      } as never
    });
    const notice = vi.fn();

    const result = planShippedCharacters(input, null, notice);

    expect(result.bundle).toBe(input);
    expect(notice).not.toHaveBeenCalled();
  });

  it("says nothing about a project with no characters", () => {
    const result = planShippedCharacters(
      { storyLibrary: { characters: [] } } as unknown as DevModeBundle,
      null
    );

    expect(result.characterIds).toEqual(new Set());
  });
});
