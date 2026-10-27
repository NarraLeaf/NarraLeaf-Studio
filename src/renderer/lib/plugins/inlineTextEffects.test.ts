/**
 * The studio half of an inline text effect: what a plugin registers for the dialogue toolbar, and how
 * the dependency scan finds the plugins a project's lines are set in.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { inlineTextEffectRegistry, normalizeInlineTextEffectDef } from "./inlineTextEffectRegistry";
import { collectStoryTextEffectUsage } from "./projectPluginUsage";

describe("normalizeInlineTextEffectDef", () => {
    it("keeps the labels live, so a getter over a translator follows the editor's language", () => {
        let language = "en";
        const entry = normalizeInlineTextEffectDef({
            id: "acme.fx.shake",
            get label() {
                return language === "en" ? "Shake" : "抖动";
            },
            params: [{
                key: "intensity",
                get label() {
                    return language === "en" ? "Intensity" : "强度";
                },
                min: 1,
                max: 10,
                default: 3,
            }],
        }, "acme.fx");
        if (typeof entry === "string") {
            throw new Error(entry);
        }
        expect([entry.label, entry.params[0].label]).toEqual(["Shake", "Intensity"]);
        language = "zh";
        expect([entry.label, entry.params[0].label]).toEqual(["抖动", "强度"]);
        // No step given: a hundredth of the range.
        expect(entry.params[0].step).toBeCloseTo(0.09);
    });

    it("refuses a parameter the slider could not show faithfully", () => {
        const def = (param: object) => normalizeInlineTextEffectDef({
            id: "acme.fx.shake",
            label: "Shake",
            params: [{ key: "speed", label: "Speed", min: 0, max: 4, default: 1, ...param }],
        }, "acme.fx");
        expect(def({})).not.toBeTypeOf("string");
        expect(def({ default: 5 })).toContain("default outside its range");
        expect(def({ min: 4, max: 4 })).toContain("max above min");
        expect(def({ key: "two words" })).toContain("parameter key");
        expect(normalizeInlineTextEffectDef({ id: "acme.fx.shake", label: "" }, "acme.fx")).toContain("label");
    });
});

describe("inlineTextEffectRegistry", () => {
    afterEach(() => {
        for (const entry of inlineTextEffectRegistry.list()) {
            // Tests own every entry they leave; the registry is process-wide.
            inlineTextEffectRegistry.register(entry)();
        }
    });

    it("lists what is registered until the cleanup it handed out runs", () => {
        const seen: number[] = [];
        const stop = inlineTextEffectRegistry.subscribe(() => seen.push(inlineTextEffectRegistry.list().length));
        const unregister = inlineTextEffectRegistry.register({ id: "acme.fx.shake", label: "Shake", params: [], ownerPluginId: "acme.fx" });
        expect(inlineTextEffectRegistry.get("acme.fx.shake")?.ownerPluginId).toBe("acme.fx");
        unregister();
        stop();
        expect(seen).toEqual([1, 0]);
        expect(inlineTextEffectRegistry.list()).toEqual([]);
    });

    it("refuses an id another plugin already registered", () => {
        const unregister = inlineTextEffectRegistry.register({ id: "acme.fx.shake", label: "Shake", params: [], ownerPluginId: "acme.fx" });
        expect(() => inlineTextEffectRegistry.register({ id: "acme.fx.shake", label: "Mine", params: [], ownerPluginId: "other" }))
            .toThrow("another owner");
        unregister();
    });
});

describe("collectStoryTextEffectUsage", () => {
    const text = (rich: unknown[]) => ({ textId: "t", value: "", role: "dialogue", rich });
    const document = {
        scenes: {
            s1: {
                blocks: {
                    a: { id: "a", kind: "nodeAction", payload: { action: "dialogue", text: text([{ text: "Run", marks: { effect: { id: "acme.fx.shake" } } }]) } },
                    b: { id: "b", kind: "nodeAction", payload: { action: "narration", text: text([{ text: "Again", marks: { effect: { id: "acme.fx.shake" } } }]) } },
                    c: { id: "c", kind: "nodeAction", payload: { action: "choice", prompt: text([{ text: "Which", marks: { effect: { id: "acme.fx.pro.glow" } } }]) } },
                    // An editor note never reaches a player, so an effect in one ships nothing.
                    d: { id: "d", kind: "note", payload: { text: text([{ text: "todo", marks: { effect: { id: "acme.notes.flash" } } }]) } },
                },
            },
        },
    } as unknown as StoryDocument;

    it("records each effect once, attributed by name to the longest plugin id it starts with", () => {
        const usage = collectStoryTextEffectUsage(document, {
            ownerOf: () => undefined,
            isRegistered: () => false,
            candidatePluginIds: ["acme.fx", "acme.fx.pro", "acme.notes"],
        });
        expect(usage).toEqual([
            { pluginId: "acme.fx", kind: "inlineTextEffect", id: "acme.fx.shake", hard: true, byName: true },
            { pluginId: "acme.fx.pro", kind: "inlineTextEffect", id: "acme.fx.pro.glow", hard: true, byName: true },
        ]);
    });

    it("credits a loaded plugin as the owner rather than reading the name", () => {
        const usage = collectStoryTextEffectUsage(document, {
            ownerOf: id => (id === "acme.fx.shake" ? "acme.fx" : undefined),
            isRegistered: id => id === "acme.fx.shake",
            candidatePluginIds: [],
        });
        expect(usage).toEqual([{ pluginId: "acme.fx", kind: "inlineTextEffect", id: "acme.fx.shake", hard: true }]);
    });
});
