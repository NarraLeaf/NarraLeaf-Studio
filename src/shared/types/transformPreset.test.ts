import { describe, expect, it } from "vitest";
import type { StoryTransformRef } from "./story";
import {
    findTransformPresetByName,
    migrateProjectTransformPresetDocument,
    normalizeTransformPresetName,
    normalizeTransformPresets,
    normalizeTransformPresetTransform,
    transformPresetSignature,
    TRANSFORM_PRESET_NAME_MAX,
    TRANSFORM_PRESET_SCHEMA_VERSION,
} from "./transformPreset";

const preset = (id: string, name: string, transform: StoryTransformRef) => ({ id, name, transform });

describe("a saved transform", () => {
    it("keeps the bag, the timing and the generator, and drops the motion", () => {
        const stored = normalizeTransformPresetTransform({
            mode: "animation",
            animationId: "anim-1",
            to: { position: { xalign: 0.25, yalign: 0.5 }, opacity: undefined },
            durationMs: 400,
            easing: "easeOut",
            repeat: 2,
            repeatType: "mirror",
            clipReveal: { kind: "wipe", direction: "left" },
        });

        expect(stored).toEqual({
            mode: "props",
            to: { position: { xalign: 0.25, yalign: 0.5 } },
            durationMs: 400,
            easing: "easeOut",
            repeat: 2,
            repeatType: "mirror",
            clipReveal: { kind: "wipe", direction: "left" },
        });
    });

    /**
     * A preset that seeds nothing is not a preset. Timing alone is what an author left behind after
     * removing every channel, and offering it in the dropdown would be a name that does nothing.
     */
    it("refuses a transform that states no channel", () => {
        expect(normalizeTransformPresetTransform({ durationMs: 400, easing: "easeOut" })).toBeNull();
        expect(normalizeTransformPresetTransform({ to: { opacity: undefined } })).toBeNull();
        expect(normalizeTransformPresetTransform(undefined)).toBeNull();
    });

    it("keeps a restore, which states a channel by clearing it", () => {
        expect(normalizeTransformPresetTransform({ to: { filter: null } }))
            .toEqual({ mode: "props", to: { filter: null } });
    });

    /**
     * The dropdown recognises a saved preset by what it states rather than by a reference, so two
     * bags that say the same thing have to compare equal however they were built.
     */
    it("compares two transforms by what they state, not by how they were written", () => {
        const left: StoryTransformRef = { mode: "props", to: { opacity: 0, zoom: 1.2 }, durationMs: 300 };
        const right: StoryTransformRef = { durationMs: 300, to: { zoom: 1.2, opacity: 0 }, animationId: undefined };

        expect(transformPresetSignature(left)).toBe(transformPresetSignature(right));
        expect(transformPresetSignature({ to: { opacity: 0 } })).not.toBe(transformPresetSignature(left));
        // Nothing stated has no signature, so a row that states nothing matches no preset.
        expect(transformPresetSignature(undefined)).toBe("");
    });
});

describe("the saved list", () => {
    it("collapses whitespace and caps a name", () => {
        expect(normalizeTransformPresetName("  Enter   from the left  ")).toBe("Enter from the left");
        expect(normalizeTransformPresetName("   ")).toBeNull();
        expect(normalizeTransformPresetName(42)).toBeNull();
        expect(normalizeTransformPresetName("x".repeat(200))).toHaveLength(TRANSFORM_PRESET_NAME_MAX);
    });

    it("drops records that are not a preset, and keeps the first of a repeated id or name", () => {
        const presets = normalizeTransformPresets([
            preset("a", "Enter", { to: { opacity: 1 } }),
            preset("a", "Second under one id", { to: { opacity: 0 } }),
            preset("b", "enter", { to: { zoom: 2 } }),
            preset("c", "", { to: { zoom: 2 } }),
            preset("d", "States nothing", {}),
            null,
        ]);

        expect(presets.map(entry => entry.id)).toEqual(["a"]);
    });

    /**
     * Code-unit order, not locale order: this file is compared and merged, and an order that
     * depended on the machine that saved it would reorder the whole list for every teammate.
     */
    it("sorts by name the same way on every machine", () => {
        const presets = normalizeTransformPresets([
            preset("c", "beta", { to: { zoom: 1 } }),
            preset("a", "Alpha", { to: { zoom: 2 } }),
            preset("b", "alpha two", { to: { zoom: 3 } }),
        ]);

        // Capitals sort before lower case, which is what every machine's code-unit order says.
        expect(presets.map(entry => entry.name)).toEqual(["Alpha", "alpha two", "beta"]);
    });

    it("finds a name whatever case it is asked in", () => {
        const presets = normalizeTransformPresets([preset("a", "Enter", { to: { opacity: 1 } })]);

        expect(findTransformPresetByName(presets, "  ENTER ")?.id).toBe("a");
        expect(findTransformPresetByName(presets, "Exit")).toBeNull();
    });

    it("reads a document with nothing readable in it as an empty list rather than throwing", () => {
        expect(migrateProjectTransformPresetDocument({ presets: "not a list" }))
            .toEqual({ schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION, presets: [] });
        expect(migrateProjectTransformPresetDocument(null))
            .toEqual({ schemaVersion: TRANSFORM_PRESET_SCHEMA_VERSION, presets: [] });
    });
});
