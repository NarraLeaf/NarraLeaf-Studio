/**
 * The two directions are one table.
 *
 * The printer spells an id as a name and the parser reads that name back as the id, so a reference
 * only one of them knows is a script that prints a word it then refuses to take. While the two
 * tables were written by hand in two files, nothing could even compare them: the fields are named
 * `assetName`/`assetId`, `appearanceName`/`appearanceRef`, and the scene axis had a `sceneId` with
 * no counterpart at all, so there was no key set to hold against another.
 *
 * {@link NARRALANG_REFERENCE_FIELDS} is what makes the pair countable, and this file is what counts
 * it: every field the parse can read is claimed by exactly one axis, every axis fills a field on
 * both tables, and every axis actually round-trips one name through a stub project. The last is the
 * one that catches a real regression - it is the assertion that failed for asset SETS, which the
 * printer named and the parse did not.
 */
import { describe, expect, it } from "vitest";

import type { StoryDocument } from "@shared/types/story";
import type { NarralangParseLookups } from "@/lib/story/narralang/narralangParse";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { Services } from "@/lib/workspace/services/services";
import {
    NARRALANG_REFERENCE_FIELDS,
    narralangReferences,
    type NarralangReferenceAxis,
} from "./narralangLookups";

/**
 * Every field of the parse table, as a record.
 *
 * A union of keys has no runtime form, so the record is what carries it into an assertion - and
 * because it is typed by that union, a field added to the table without being added here stops the
 * build rather than quietly going unguarded. The same shape `narralangIo.test.ts` uses for the
 * printer's issue reasons.
 */
const EVERY_PARSE_FIELD: Record<keyof NarralangParseLookups, true> = {
    characterId: true,
    assetId: true,
    appearanceRef: true,
    motionId: true,
    appTagId: true,
    surfaceId: true,
    sceneId: true,
    variableRef: true,
};

// --- A project with one of everything ---------------------------------------------------------

const CHARACTERS = [
    {
        profile: {
            getId: () => "char-alice",
            getName: () => "爱丽丝",
            getColor: () => null,
            appearance: {
                getKind: () => "preset" as const,
                getPoses: () => [{ id: "pose-smile", name: "smile" }],
                getAxes: () => [],
            },
        },
    },
    {
        profile: {
            getId: () => "char-doll",
            getName: () => "人偶",
            getColor: () => null,
            appearance: {
                getKind: () => "layered" as const,
                getPoses: () => [],
                getAxes: () => [{ id: "axis-mood", tags: [{ id: "tag-happy", name: "happy" }] }],
            },
        },
    },
];

const SERVICES = {
    get(id: Services) {
        switch (id) {
            case Services.Character:
                return { listCharacter: () => CHARACTERS };
            case Services.Story:
                return { listAnimationAssets: () => [{ id: "anim-shake", name: "handheld shake" }] };
            case Services.LocalBlueprint:
                return {
                    listSavedVariables: () => [{ id: "var-gold", name: "gold" }],
                    listPersistentVariables: () => [{ id: "entry-seen", storageKey: "seen_intro", name: "seen intro" }],
                };
            case Services.AppTags:
                return { listTags: () => [{ id: "tag-demo", name: "Demo" }] };
            case Services.UIDocument:
                return { getDocument: () => ({ surfaces: [{ id: "surface-map", name: "地图" }] }) };
            case Services.Assets:
                return { getAssets: () => ({ image: { "asset-bg": { name: "corridor_dusk" } } }) };
            case Services.AssetSets:
                // The half the parse used to be missing: a row may name a set, and the printer has
                // always spelled one (`resolveAssetDisplayName` asks the set registry after the
                // library), so a set the parse could not resolve was a name the script wrote and
                // refused to read.
                return { listSets: () => [{ id: "set-rain", name: "rain" }] };
            default:
                throw new Error(`no stub for ${id}`);
        }
    },
} as unknown as WorkspaceContext["services"];

const DOCUMENT = {
    scenes: { "scene-2": { id: "scene-2", name: "天台 · 夜" } },
} as unknown as StoryDocument;

const { lookups, parseLookups } = narralangReferences(SERVICES, DOCUMENT);

/**
 * One name, taken out and put back, per axis.
 *
 * Keyed by the axis union so an axis added without a check is a compile error - the point being that
 * a new "store an id, spell it by name" row cannot be added on one side only, which is exactly what
 * had happened to sets.
 */
const ROUND_TRIPS: Record<NarralangReferenceAxis, () => void> = {
    character: () => {
        expect(lookups.character("char-alice")?.name).toBe("爱丽丝");
        expect(parseLookups.characterId?.("爱丽丝")).toBe("char-alice");
    },
    asset: () => {
        expect(lookups.assetName?.("asset-bg")).toBe("corridor_dusk");
        expect(parseLookups.assetId?.("corridor_dusk")).toBe("asset-bg");
        expect(lookups.assetName?.("set-rain")).toBe("rain");
        expect(parseLookups.assetId?.("rain")).toBe("set-rain");
    },
    appearance: () => {
        expect(lookups.appearanceName?.("char-alice", "pose-smile")).toBe("smile");
        expect(parseLookups.appearanceRef?.("char-alice", "smile")).toEqual({ kind: "pose", id: "pose-smile" });
        // A layered character's tag carries the axis that owns it, which a script never says.
        expect(lookups.appearanceName?.("char-doll", "tag-happy")).toBe("happy");
        expect(parseLookups.appearanceRef?.("char-doll", "happy")).toEqual({ kind: "tag", axisId: "axis-mood", id: "tag-happy" });
    },
    motion: () => {
        expect(lookups.motionName?.("anim-shake")).toBe("handheld shake");
        expect(parseLookups.motionId?.("handheld shake")).toBe("anim-shake");
    },
    appTag: () => {
        expect(lookups.appTagName?.("tag-demo")).toBe("Demo");
        expect(parseLookups.appTagId?.("Demo")).toBe("tag-demo");
    },
    surface: () => {
        expect(lookups.surfaceName?.("surface-map")).toBe("地图");
        expect(parseLookups.surfaceId?.("地图")).toBe("surface-map");
    },
    scene: () => {
        expect(lookups.scenes?.["scene-2"]?.name).toBe("天台 · 夜");
        expect(parseLookups.sceneId?.("天台 · 夜")).toBe("scene-2");
    },
    variable: () => {
        // The two project scopes address their entry differently - `saved` by entry id, `persistent`
        // by storage key - and one axis answers for both, which is the asymmetry a second table
        // would have had to remember on its own.
        expect(lookups.projectVariableName?.("saved", "var-gold")).toBe("gold");
        expect(parseLookups.variableRef?.("gold")).toEqual({ scope: "saved", variableId: "var-gold" });
        expect(lookups.projectVariableName?.("persistent", "seen_intro")).toBe("seen intro");
        expect(parseLookups.variableRef?.("seen intro")).toEqual({ scope: "persistent", variableId: "seen_intro" });
    },
};

describe("the NarraLang reference tables", () => {
    it("claims every field the parse can read, exactly once", () => {
        const claimed = Object.values(NARRALANG_REFERENCE_FIELDS).map(fields => fields.parse);

        expect([...claimed].sort()).toEqual(Object.keys(EVERY_PARSE_FIELD).sort());
    });

    it("fills both directions of every axis", () => {
        for (const [axis, fields] of Object.entries(NARRALANG_REFERENCE_FIELDS)) {
            expect(lookups[fields.print], `${axis}: the printer has no ${fields.print}`).toBeDefined();
            expect(parseLookups[fields.parse], `${axis}: the parse has no ${fields.parse}`).toBeDefined();
        }
    });

    for (const [axis, check] of Object.entries(ROUND_TRIPS)) {
        it(`spells a ${axis} and reads the same one back`, check);
    }

    it("refuses to pick between two things answering to one name", () => {
        const twins = {
            get(id: Services) {
                if (id === Services.AppTags) {
                    return { listTags: () => [{ id: "tag-a", name: "Demo" }, { id: "tag-b", name: "Demo" }] };
                }
                return SERVICES.get(id);
            },
        } as unknown as WorkspaceContext["services"];

        expect(narralangReferences(twins, DOCUMENT).parseLookups.appTagId?.("Demo")).toBe("ambiguous");
    });
});
