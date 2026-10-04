import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import type { LocalizationUnit } from "@shared/types/localization";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import {
    goldenDifferences,
    migrateGoldenProject,
    resolveAfterV13,
    resolveBeforeV13,
    type GoldenProject,
} from "@/lib/ui-editor/runtime/testing/textSourceGoldenKit";

/**
 * The v13 step against the game's resolver: every text site of a batch of odd documents - one per
 * rule of the step, and the combinations a hand, a tool or an old paste can leave behind - resolved
 * in English, Chinese and Japanese and on the canvas, before the step (under the runtime that read
 * v12) and after it (under the runtime that reads v13). The words have to be the same everywhere;
 * where they cannot be, the element has to be one the step reports. The shipped templates are run
 * the same way by the acceptance driver against their files from before the step.
 */

const unit = (target: string): LocalizationUnit => ({ target, sourceHash: "fnv1a:1", status: "translated" });
const layout = { x: 0, y: 0, width: 10, height: 10 };
const BOUND = { text: { kind: "blueprintValue" as const, blueprintId: "bp", valueType: "string" as const } };
const BOUND_LABEL = { label: { kind: "blueprintValue" as const, blueprintId: "bp", valueType: "string" as const } };
const FIELD = { text: { kind: "listItemField" as const, fieldId: "name" } };

function widget(id: string, type: string, props: Record<string, unknown>, extra: Partial<UIElement> = {}): UIElement {
    return { id, type, name: id, parentId: "root", childrenIds: [], layout, props, ...extra };
}

function documentOf(elements: UIElement[], surface: Partial<UISurface> = {}): UIDocument {
    return {
        schemaVersion: 12,
        id: "doc",
        name: "UI",
        surfaces: [{
            id: "page",
            name: "Page",
            host: "app",
            kind: "appSurface",
            designSize: { width: 10, height: 10 },
            rootElementId: "root",
            ...surface,
        } as UISurface],
        elements: Object.fromEntries([
            ["root", { id: "root", type: "nl.root", parentId: null, childrenIds: elements.map(element => element.id), layout }],
            ...elements.map(element => [element.id, element]),
        ]),
    };
}

/** A page whose own graph writes over `elementId`'s words with Set Text. */
function writtenOver(elementId: string): BlueprintDocument {
    const owner = { kind: "surfaceMain" as const, surfaceId: "page" };
    return {
        schemaVersion: 10,
        blueprints: {
            bp: {
                id: "bp",
                name: "Page",
                owner,
                graphs: {
                    events: {
                        main: {
                            id: "main",
                            graph: {
                                nodes: {
                                    ref: { id: "ref", type: "blueprint.element.ref", params: { surfaceId: "page", elementId, elementType: "nl.text" } },
                                    write: { id: "write", type: "blueprint.element.text.setText" },
                                },
                                edges: [{ from: { nodeId: "ref", port: "element" }, to: { nodeId: "write", port: "element" } }],
                            },
                        },
                    },
                    functions: {},
                },
            },
        },
        ownerRecords: { [encodeBlueprintOwnerKey(owner)]: { blueprintId: "bp" } },
    } as unknown as BlueprintDocument;
}

const KEYS = { "menu.start": "Start", "menu.load": "Load" };

function project(document: UIDocument, options: Partial<GoldenProject> = {}): GoldenProject {
    return {
        document,
        blueprints: null,
        keys: KEYS,
        sourceLocale: "en",
        locales: ["en", "zh-CN", "ja"],
        translations: {
            "zh-CN": { "key:menu.start": unit("开始"), "key:menu.gone": unit("旧键") },
            ja: { "key:menu.start": unit("スタート") },
        },
        ...options,
    };
}

/** Run one project before and after; the differences, and the elements the step reported. */
function run(input: GoldenProject) {
    const before = resolveBeforeV13(input);
    const migrated = migrateGoldenProject(input);
    const after = resolveAfterV13(migrated.project);
    return {
        before,
        after,
        differences: goldenDifferences(before, after),
        reported: new Set(migrated.changes.map(change => change.elementId)),
        changes: migrated.changes,
    };
}

/** Every rule of the step, and the odd combinations around them. */
const ODD_DOCUMENTS: Record<string, GoldenProject> = {
    "a keyed copy, with marks and a switch": project(documentOf([
        widget("copy", "nl.button", { label: "Start", localizationKey: "menu.start" }),
        widget("stale-copy", "nl.button", { label: "Begin", localizationKey: "menu.start", localizable: true }),
        widget("marked", "nl.text", { text: "Start", localizationKey: "menu.start", rich: [{ text: "Start", marks: { bold: true } }] }),
        widget("unmarked", "nl.text", { text: "Start", localizationKey: "menu.start", rich: [{ text: "Other" }] }),
        widget("no-copy", "nl.text", { localizationKey: "menu.load" }),
    ])),
    "a key beside a binding": project(documentOf([
        widget("key-bound", "nl.text", { text: "Start", localizationKey: "menu.start" }, { valueBindings: BOUND }),
        widget("key-field", "nl.text", { text: "Start", localizationKey: "menu.start" }, { valueBindings: FIELD }),
        widget("key-label-bound", "nl.button", { label: "Start", localizationKey: "menu.start" }, { valueBindings: BOUND_LABEL }),
    ])),
    "a key the project does not have": project(documentOf([
        widget("gone", "nl.button", { label: "Continue", localizationKey: "menu.gone" }),
        widget("gone-untranslated", "nl.text", { text: "Credits", localizationKey: "menu.credits", localizable: true }),
        widget("gone-bound", "nl.text", { text: "sample", localizationKey: "menu.gone" }, { valueBindings: BOUND }),
    ]), {
        translations: {
            "zh-CN": { "key:menu.start": unit("开始"), "key:menu.gone": unit("旧键"), "ui:gone-untranslated.text": unit("制作") },
            ja: { "ui:gone.label": unit("古い") },
        },
    }),
    "keys in a project without a source language": project(documentOf([
        widget("same", "nl.text", { text: "Start", localizationKey: "menu.start" }),
        widget("differs", "nl.text", { text: "Begin", localizationKey: "menu.start" }),
        widget("differs-marked", "nl.text", { text: "Start", localizationKey: "menu.start", rich: [{ text: "Start", marks: { italic: true } }] }),
        widget("bound", "nl.text", { text: "Start", localizationKey: "menu.start" }, { valueBindings: BOUND }),
        widget("gone", "nl.text", { text: "Credits", localizationKey: "menu.gone" }),
        widget("no-copy", "nl.button", { localizationKey: "menu.load" }),
    ]), { sourceLocale: "", locales: [] }),
    "own words with and without the switch": project(documentOf([
        widget("translated", "nl.text", { text: "Your Game", localizable: true }),
        widget("switched-digits", "nl.text", { text: "3", localizable: true }),
        widget("leftover", "nl.text", { text: "Credits" }),
        widget("plain", "nl.button", { label: "Back" }),
        widget("blank", "nl.text", { text: "", localizable: true }),
        widget("absent", "nl.text", {}),
    ]), {
        translations: {
            "zh-CN": { "ui:translated.text": unit("你的游戏"), "ui:switched-digits.text": unit("三"), "ui:leftover.text": unit("制作人员") },
            ja: { "ui:leftover.label": unit("戻る"), "ui:plain.label": unit("戻る") },
        },
    }),
    "a switch under a binding or a writer": project(documentOf([
        widget("switched-bound", "nl.text", { text: "sample", localizable: true }, { valueBindings: BOUND }),
        widget("switched-field", "nl.text", { text: "Name", localizable: true }, { valueBindings: FIELD }),
        widget("written", "nl.text", { text: "The corridor", localizable: true }),
    ]), {
        blueprints: writtenOver("written"),
        translations: {
            "zh-CN": { "ui:switched-bound.text": unit("示例"), "ui:switched-field.text": unit("名字"), "ui:written.text": unit("走廊") },
        },
    }),
    "placeholders": project(documentOf([
        widget("keyed", "nl.textInput", { placeholder: "Start", placeholderLocalizationKey: "menu.start" }),
        widget("stale", "nl.textInput", { placeholder: "Type here", placeholderLocalizationKey: "menu.start" }),
        widget("gone", "nl.textInput", { placeholder: "Your name", placeholderLocalizationKey: "field.name" }),
        widget("own", "nl.textInput", { placeholder: "Your name" }),
    ]), {
        translations: { "zh-CN": { "key:menu.start": unit("开始"), "ui:own.placeholder": unit("旧") } },
    }),
    "dialogue lines in and out of their slot": project(documentOf([
        widget("line", "nl.dialog.sentence", { text: "A line", localizable: true }, { valueBindings: BOUND }),
        widget("nvl", "nl.nvl.texts", { text: "A line" }, { valueBindings: BOUND }),
    ], { host: "player", kind: "stageSurface", mount: { kind: "slot", slotId: "dialog" } } as Partial<UISurface>)),
};

describe("the v13 step against the game's resolver", () => {
    for (const [name, input] of Object.entries(ODD_DOCUMENTS)) {
        it(`shows the same words in every language for ${name}, except where it reports the element`, () => {
            const { differences, reported } = run(input);
            for (const difference of differences) {
                const elementId = difference.site.split(".")[0];
                expect(reported.has(elementId), `${difference.site} differs in ${difference.views.join(", ")}`).toBe(true);
            }
        });
    }

    it("changes the words only where a missing key's old translation stood over a binding", () => {
        const all = Object.values(ODD_DOCUMENTS).flatMap(input => run(input).differences.map(difference => difference.site));
        expect(all).toEqual(["gone-bound.text"]);
    });

    it("reports exactly the elements whose source of words changes, and no other", () => {
        const reported = Object.entries(ODD_DOCUMENTS).flatMap(([name, input]) =>
            run(input).changes.map(change => `${name}: ${change.elementId} ${change.kind}`));
        expect(reported.sort()).toEqual([
            "a key beside a binding: key-bound bindingDropped",
            "a key beside a binding: key-field bindingDropped",
            "a key beside a binding: key-label-bound bindingDropped",
            "a key the project does not have: gone missingKey",
            "a key the project does not have: gone-bound missingKey",
            "a key the project does not have: gone-untranslated missingKey",
            "a keyed copy, with marks and a switch: marked marksKept",
            "keys in a project without a source language: differs keyDiffered",
            "keys in a project without a source language: gone missingKey",
            "keys in a project without a source language: no-copy keyDiffered",
            "placeholders: gone missingKey",
        ]);
    });
});
