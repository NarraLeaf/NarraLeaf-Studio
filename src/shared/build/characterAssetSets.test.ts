import { describe, expect, it } from "vitest";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { DevModeCharacterSummary } from "../types/devMode";
import type { GameLocalizationBundle } from "../types/localization";
import { attachCharacterAssetSetVariants, charactersNameUnresolvedSet } from "./characterAssetSets";

/**
 * The answers a character carries for the sets it names.
 *
 * Two failures are guarded here, and only one of them is visible by playing the game. The visible
 * one is a set id reaching the runtime, which draws nothing. The other is the reason this is not a
 * table: an answer that covers more than the reference it belongs to, so that holding one picture
 * hands over another one nobody asked about.
 */

const SET = "11111111-1111-4111-8111-111111111111";
const OTHER_SET = "22222222-1111-4111-8111-111111111111";
const EN = "aaaaaaaa-1111-4111-8111-111111111111";
const JA = "bbbbbbbb-1111-4111-8111-111111111111";
const EN2 = "cccccccc-1111-4111-8111-111111111111";
const JA2 = "dddddddd-1111-4111-8111-111111111111";
const ADULT = "eeeeeeee-1111-4111-8111-111111111111";
const ALLAGES = "ffffffff-1111-4111-8111-111111111111";

function localeSet(id: string, tag: string): AssetSet {
    return {
        id,
        name: `Art ${tag}`,
        type: "image",
        filter: [`cg:${tag}`],
        axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"], fallback: "en" },
    };
}

function releaseSet(): AssetSet {
    return {
        id: SET,
        name: "Poster",
        type: "image",
        filter: ["cg:poster"],
        axis: { kind: "release", key: "release", residency: "build", values: ["main", "allages"], fallback: "main" },
    };
}

function library(entries: Array<[string, string[]]>): AssetSetCandidate[] {
    return entries.map(([id, tags]) => ({ id, type: "image", tags }));
}

const LIBRARY = library([
    [EN, ["cg:title", "locale:en"]],
    [JA, ["cg:title", "locale:ja"]],
    [EN2, ["cg:sign", "locale:en"]],
    [JA2, ["cg:sign", "locale:ja"]],
]);

function localization(): Pick<GameLocalizationBundle, "sourceLocale" | "locales"> {
    return {
        sourceLocale: "en",
        locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
    };
}

function preset(poses: Array<{ id: string; assetId: string | null }>): DevModeCharacterSummary {
    return {
        id: "c1",
        name: "Alice",
        appearance: {
            kind: "preset",
            defaultPoseId: poses[0]?.id ?? null,
            poses: poses.map(pose => ({ id: pose.id, name: pose.id, assetId: pose.assetId })),
        },
    } as DevModeCharacterSummary;
}

function attach(characters: DevModeCharacterSummary[], sets: AssetSet[], assetAxes?: Record<string, string>) {
    return attachCharacterAssetSetVariants({
        characters,
        sets,
        candidates: [...LIBRARY, ...library([[ADULT, ["cg:poster", "release:main"]], [ALLAGES, ["cg:poster", "release:allages"]]])],
        localization: localization(),
        ...(assetAxes ? { assetAxes } : {}),
    });
}

describe("attachCharacterAssetSetVariants", () => {
    it("answers a pose with its own languages, on that pose", () => {
        const character = preset([{ id: "p1", assetId: SET }]);
        const result = attach([character], [localeSet(SET, "title")]);
        expect(result.problems).toEqual([]);
        const appearance = character.appearance as Extract<DevModeCharacterSummary["appearance"], { kind: "preset" }>;
        expect(appearance.poses[0].assetVariants).toEqual({ [SET]: { en: EN, ja: JA } });
        expect([...result.referencedAssetIds].sort()).toEqual([EN, JA].sort());
    });

    it("never lets one pose's answer reach another pose", () => {
        // The property that makes this not a table. Two poses, two different sets: holding the first
        // pose must not be a way to learn what the second one resolves to in another language.
        const character = preset([{ id: "p1", assetId: SET }, { id: "p2", assetId: OTHER_SET }]);
        attach([character], [localeSet(SET, "title"), localeSet(OTHER_SET, "sign")]);
        const appearance = character.appearance as Extract<DevModeCharacterSummary["appearance"], { kind: "preset" }>;
        expect(appearance.poses[0].assetVariants).toEqual({ [SET]: { en: EN, ja: JA } });
        expect(appearance.poses[1].assetVariants).toEqual({ [OTHER_SET]: { en: EN2, ja: JA2 } });
        // And the character itself carries nothing: it named no set of its own.
        expect(character.assetVariants).toBeUndefined();
        expect(JSON.stringify(appearance.poses[0])).not.toContain(EN2);
        expect(JSON.stringify(appearance.poses[1])).not.toContain(EN);
    });

    it("replaces the id outright for a build axis, naming no other variant", () => {
        // The whole point of a build axis: the variant this edition withheld must not be nameable in
        // the package, because the byte scan decides what to copy by looking for ids in the bytes.
        const character = preset([{ id: "p1", assetId: SET }]);
        const result = attach([character], [releaseSet()], { release: "allages" });
        const appearance = character.appearance as Extract<DevModeCharacterSummary["appearance"], { kind: "preset" }>;
        expect(appearance.poses[0].assetId).toBe(ALLAGES);
        expect(appearance.poses[0].assetVariants).toBeUndefined();
        expect(result.collapsedBuildAxis).toBe(true);
        expect(JSON.stringify(character)).not.toContain(ADULT);
    });

    it("refuses a build axis this edition never took a position on", () => {
        const character = preset([{ id: "p1", assetId: SET }]);
        const result = attach([character], [releaseSet()]);
        const appearance = character.appearance as Extract<DevModeCharacterSummary["appearance"], { kind: "preset" }>;
        expect(appearance.poses[0].assetId).toBe(SET);
        expect(result.problems.map(problem => problem.kind)).toEqual(["axisUnset"]);
    });

    it("reports one unfinished set once, however many poses name it", () => {
        const character = preset([{ id: "p1", assetId: SET }, { id: "p2", assetId: SET }]);
        const result = attach([character], [{
            ...localeSet(SET, "title"),
            axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"], fallback: "de" },
            filter: ["cg:nothing"],
        }]);
        expect(result.problems).toHaveLength(1);
    });

    it("puts a layer's option table on the layer, and the character's own field on the character", () => {
        const character = {
            id: "c1",
            name: "Alice",
            defaultAvatarAssetId: OTHER_SET,
            appearance: {
                kind: "layered",
                canvas: null,
                axes: [{ id: "mood", name: "Mood", tags: [{ id: "happy", name: "Happy" }], defaultTagId: "happy" }],
                layers: [{ id: "l1", name: "Face", axisId: "mood", options: { happy: SET } }],
            },
        } as unknown as DevModeCharacterSummary;
        attach([character], [localeSet(SET, "title"), localeSet(OTHER_SET, "sign")]);
        const appearance = character.appearance as Extract<DevModeCharacterSummary["appearance"], { kind: "layered" }>;
        expect(appearance.layers[0].assetVariants).toEqual({ [SET]: { en: EN, ja: JA } });
        expect(character.assetVariants).toEqual({ [OTHER_SET]: { en: EN2, ja: JA2 } });
    });

    it("leaves a project with no sets exactly as it was", () => {
        const character = preset([{ id: "p1", assetId: EN }]);
        const before = JSON.stringify(character);
        attach([character], []);
        expect(JSON.stringify(character)).toBe(before);
    });
});

describe("charactersNameUnresolvedSet", () => {
    it("catches a set id that was never filled, and passes one that was", () => {
        const filled = preset([{ id: "p1", assetId: SET }]);
        attach([filled], [localeSet(SET, "title")]);
        expect(charactersNameUnresolvedSet([filled], new Set([SET]))).toBe(false);

        const unfilled = preset([{ id: "p1", assetId: SET }]);
        expect(charactersNameUnresolvedSet([unfilled], new Set([SET]))).toBe(true);
    });
});
