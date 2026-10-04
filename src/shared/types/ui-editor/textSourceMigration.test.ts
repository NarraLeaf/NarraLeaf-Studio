import { describe, expect, it } from "vitest";
import { ProjectDocumentTooNewError, refuseNewerProjectDocument } from "../../documents/newerSchema";
import type { LocalizationUnit } from "../localization";
import { UI_DOCUMENT_MIN_SUPPORTED_VERSION, UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "./document";
import {
    applyUITextLocaleEdits,
    migrateUITextSourcesV13,
    settleIncomingUITextSources,
    UI_TEXT_SOURCES_SCHEMA_VERSION,
    type UITextMigrationInput,
} from "./textSourceMigration";

/**
 * The v13 step, one rule per case. What each rule holds to is that the words a site shows, in every
 * language, are the words it showed before; `textSourceMigration.golden.test.ts` checks that against
 * the game's resolver over the shipped templates and a batch of odd documents.
 */

function element(
    id: string,
    type: string,
    props: Record<string, unknown>,
    extra: Partial<UIElement> = {},
): UIElement {
    return {
        id,
        type,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props,
        ...extra,
    };
}

function documentOf(elements: UIElement[], options: { surface?: Partial<UISurface>; components?: UIDocument["components"] } = {}): UIDocument {
    const root: UIElement = {
        id: "root",
        type: "nl.root",
        parentId: null,
        childrenIds: elements.map(entry => entry.id),
        layout: { x: 0, y: 0, width: 100, height: 100 },
    };
    const surface = {
        id: "page",
        name: "Title",
        host: "app",
        kind: "appSurface",
        designSize: { width: 100, height: 100 },
        rootElementId: "root",
        ...options.surface,
    } as UISurface;
    return {
        schemaVersion: 12,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        elements: Object.fromEntries([root, ...elements].map(entry => [entry.id, entry])),
        ...(options.components ? { components: options.components } : {}),
    };
}

function unit(target: string, sourceHash = "fnv1a:00000000"): LocalizationUnit {
    return { target, sourceHash, status: "translated" };
}

const KEYS = { "menu.start": "Start", "menu.load": "Load" };

function input(overrides: Partial<UITextMigrationInput> = {}): UITextMigrationInput {
    return {
        keys: KEYS,
        sourceLocale: "en",
        translations: {
            "zh-CN": { "key:menu.start": unit("开始", "fnv1a:start") },
            ja: {},
        },
        ...overrides,
    };
}

const BOUND = { kind: "blueprintValue" as const, blueprintId: "bp", valueType: "string" as const };

describe("the v13 document version", () => {
    it("is what this build writes, over the same floor", () => {
        expect(UI_DOCUMENT_SCHEMA_VERSION).toBe(UI_TEXT_SOURCES_SCHEMA_VERSION);
        expect(UI_DOCUMENT_MIN_SUPPORTED_VERSION).toBe(10);
    });

    it("is refused by a Studio that writes v12, through the newer-document refusal every reader shares", () => {
        // The gate a v12 build runs on every read of `uidoc.json` - the bundle assembler and the
        // document spec call it directly, and `UIDocumentService` throws the same error value.
        let thrown: unknown;
        try {
            refuseNewerProjectDocument({ schemaVersion: UI_TEXT_SOURCES_SCHEMA_VERSION }, {
                kind: "uiDocument",
                subject: "editor/ui/uidoc.json",
                supportedVersion: 12,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ProjectDocumentTooNewError);
        expect((thrown as ProjectDocumentTooNewError).version).toBe(13);
        expect((thrown as ProjectDocumentTooNewError).supportedVersion).toBe(12);
    });
});

describe("migrateUITextSourcesV13", () => {
    it("stamps v13 and leaves a document already there alone", () => {
        const before = documentOf([element("t", "nl.text", { text: "Hello" })]);
        const result = migrateUITextSourcesV13(before, input());
        expect(result.document.schemaVersion).toBe(UI_TEXT_SOURCES_SCHEMA_VERSION);
        expect(before.schemaVersion).toBe(12);

        const settled = migrateUITextSourcesV13(result.document, input({
            translations: { "zh-CN": { "ui:t.text": unit("你好") } },
        }));
        expect(settled.document).toBe(result.document);
        expect(settled.localeEdits).toEqual({});
    });

    it("rule 1: a keyed element keeps the key and loses its copy, its marks and its switch", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("b", "nl.button", { label: "Start", localizationKey: "menu.start", localizable: true, rich: [{ text: "Begin" }] })]),
            input(),
        );
        expect(result.document.elements.b.props).toEqual({ localizationKey: "menu.start" });
        expect(result.changes).toEqual([]);
    });

    it("rule 1: marks drawn over the key's words stay, with the words and the key's translations, on the element", () => {
        const rich = [{ text: "St", marks: { bold: true } }, { text: "art" }];
        const result = migrateUITextSourcesV13(
            documentOf([element("b", "nl.button", { label: "Start", localizationKey: "menu.start", rich })]),
            input({
                translations: {
                    "zh-CN": { "key:menu.start": unit("开始", "fnv1a:start") },
                    ja: { "ui:b.label": unit("スタート（古い）") },
                },
            }),
        );
        expect(result.document.elements.b.props).toEqual({ label: "Start", rich });
        expect(result.localeEdits).toEqual({
            "zh-CN": { set: { "ui:b.label": unit("开始", "fnv1a:start") }, remove: [] },
            ja: { set: {}, remove: ["ui:b.label"] },
        });
        expect(result.changes).toEqual([
            { kind: "marksKept", elementId: "b", prop: "label", keyName: "menu.start", surfaceId: "page" },
        ]);
    });

    it("rule 1: a binding beside a key never showed, and goes", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Start", localizationKey: "menu.start" }, { valueBindings: { text: BOUND } })]),
            input(),
        );
        expect(result.document.elements.t.valueBindings).toBeUndefined();
        expect(result.document.elements.t.props).toEqual({ localizationKey: "menu.start" });
        expect(result.changes.map(change => change.kind)).toEqual(["bindingDropped"]);
    });

    it("rule 2: a key the project does not have becomes the element's own words, with the translations still read for it", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Continue", localizationKey: "menu.continue", localizable: true })]),
            input({
                translations: {
                    "zh-CN": { "key:menu.continue": unit("继续", "fnv1a:cont") },
                    ja: { "ui:t.text": unit("つづき") },
                },
            }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "Continue" });
        expect(result.localeEdits).toEqual({
            "zh-CN": { set: { "ui:t.text": unit("继续", "fnv1a:cont") }, remove: [] },
            ja: { set: {}, remove: ["ui:t.text"] },
        });
        expect(result.changes).toEqual([
            { kind: "missingKey", elementId: "t", prop: "text", keyName: "menu.continue", surfaceId: "page" },
        ]);
    });

    it("rule 2: a missing key over a binding leaves the binding showing, everywhere", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "sample", localizationKey: "gone" }, { valueBindings: { text: BOUND } })]),
            input({ translations: { "zh-CN": { "key:gone": unit("旧") } } }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "sample" });
        expect(result.document.elements.t.valueBindings).toEqual({ text: BOUND });
        expect(result.localeEdits).toEqual({});
    });

    it("rule 3: without a source language, words equal to the key's give way to the key", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Start", localizationKey: "menu.start" })]),
            input({ sourceLocale: "" }),
        );
        expect(result.document.elements.t.props).toEqual({ localizationKey: "menu.start" });
        expect(result.changes).toEqual([]);
    });

    it("rule 3: without a source language, words that differ from the key's stay, and the key goes", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Begin", localizationKey: "menu.start" })]),
            input({ sourceLocale: "" }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "Begin" });
        expect(result.changes.map(change => change.kind)).toEqual(["keyDiffered"]);
    });

    it("rule 3: without a source language, a binding beside a key went on showing, and still does", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Start", localizationKey: "menu.start" }, { valueBindings: { text: BOUND } })]),
            input({ sourceLocale: "" }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "Start" });
        expect(result.document.elements.t.valueBindings).toEqual({ text: BOUND });
        expect(result.changes).toEqual([]);
    });

    it("rule 3: without a source language, marks drawn over the element's own words stay with them", () => {
        const rich = [{ text: "Start", marks: { bold: true } }];
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Start", rich, localizationKey: "menu.start" })]),
            input({ sourceLocale: "" }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "Start", rich });
        expect(result.changes).toEqual([]);
    });

    it("rule 4: an element that translated its own words loses the switch and keeps the translations", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Your Game", localizable: true })]),
            input({ translations: { "zh-CN": { "ui:t.text": unit("你的游戏") } } }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "Your Game" });
        expect(result.localeEdits).toEqual({});
    });

    it("rule 5: a translation left behind by words that stopped being translated is removed", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "Your Game" }), element("p", "nl.textInput", { placeholder: "Name" })]),
            input({ translations: { "zh-CN": { "ui:t.text": unit("旧"), "ui:p.placeholder": unit("名字") }, ja: {} } }),
        );
        expect(result.localeEdits).toEqual({ "zh-CN": { set: {}, remove: ["ui:t.text", "ui:p.placeholder"] } });
    });

    it("rule 6: the switch under a binding goes, and nothing else changes", () => {
        const result = migrateUITextSourcesV13(
            documentOf([element("t", "nl.text", { text: "sample", localizable: true }, { valueBindings: { text: { kind: "listItemField", fieldId: "name" } } })]),
            input({ translations: { "zh-CN": { "ui:t.text": unit("示例") } } }),
        );
        expect(result.document.elements.t.props).toEqual({ text: "sample" });
        expect(result.document.elements.t.valueBindings).toEqual({ text: { kind: "listItemField", fieldId: "name" } });
        expect(result.localeEdits).toEqual({});
        expect(result.changes).toEqual([]);
    });

    it("rule 7: a placeholder's key is read through the text site table", () => {
        const result = migrateUITextSourcesV13(
            documentOf([
                element("p", "nl.textInput", { placeholder: "Start", placeholderLocalizationKey: "menu.start" }),
                element("q", "nl.textInput", { placeholder: "Your name", placeholderLocalizationKey: "field.name" }),
            ]),
            input(),
        );
        expect(result.document.elements.p.props).toEqual({ placeholderLocalizationKey: "menu.start" });
        expect(result.document.elements.q.props).toEqual({ placeholder: "Your name" });
        expect(result.changes.map(change => change.kind)).toEqual(["missingKey"]);
    });

    it("rule 8: a binding on a dialogue line in the dialogue slot goes, and stays on any other page", () => {
        const inSlot = migrateUITextSourcesV13(
            documentOf(
                [element("s", "nl.dialog.sentence", { text: "A line" }, { valueBindings: { text: BOUND } })],
                { surface: { host: "player", kind: "stageSurface", mount: { kind: "slot", slotId: "dialog" } } as Partial<UISurface> },
            ),
            input(),
        );
        expect(inSlot.document.elements.s.valueBindings).toBeUndefined();
        expect(inSlot.changes).toEqual([]);

        const elsewhere = migrateUITextSourcesV13(
            documentOf([element("s", "nl.dialog.sentence", { text: "A line" }, { valueBindings: { text: BOUND } })]),
            input(),
        );
        expect(elsewhere.document.elements.s.valueBindings).toEqual({ text: BOUND });
    });

    it("migrates a component definition's elements and leaves an instance's alone", () => {
        const result = migrateUITextSourcesV13(
            documentOf(
                [element("inst", "nl.button", { label: "Start", localizationKey: "menu.start" }, { extra: { componentLink: { componentId: "c", linked: true } } })],
                {
                    components: [{
                        id: "c",
                        name: "Slot",
                        rootElementId: "cb",
                        elements: { cb: element("cb", "nl.button", { label: "Gone", localizationKey: "gone" }) },
                    }],
                },
            ),
            input(),
        );
        expect(result.document.elements.inst.props).toEqual({ label: "Start", localizationKey: "menu.start" });
        expect(result.document.components?.[0].elements.cb.props).toEqual({ label: "Gone" });
        expect(result.changes).toEqual([
            { kind: "missingKey", elementId: "cb", prop: "label", keyName: "gone", componentId: "c" },
        ]);
    });

    it("settles elements arriving from elsewhere against this project's keys", () => {
        const arriving = {
            kept: element("kept", "nl.button", { label: "Start", localizationKey: "menu.start", localizable: true }),
            carried: element("carried", "nl.button", { localizationKey: "menu.extra" }),
            copy: element("copy", "nl.text", { text: "Credits", localizationKey: "menu.credits" }),
            bare: element("bare", "nl.text", { localizationKey: "menu.bare" }),
            own: element("own", "nl.text", { text: "Your Game", localizable: true }),
        };
        const { table, converted } = settleIncomingUITextSources(arriving, {
            hasKey: name => name === "menu.start",
            carried: { "menu.extra": { words: "Extra", translations: { "zh-CN": unit("鉴赏") } } },
        });
        expect(table.kept.props).toEqual({ localizationKey: "menu.start" });
        expect(table.carried.props).toEqual({ label: "Extra" });
        expect(table.copy.props).toEqual({ text: "Credits" });
        expect(table.bare.props).toEqual({ text: "menu.bare" });
        expect(table.own.props).toEqual({ text: "Your Game" });
        expect(converted.map(site => `${site.elementId}:${site.keyName}`)).toEqual([
            "carried:menu.extra",
            "copy:menu.credits",
            "bare:menu.bare",
        ]);
        // Nothing to settle hands the table back as it came.
        const settled = { plain: element("plain", "nl.text", { text: "Hi" }) };
        expect(settleIncomingUITextSources(settled, { hasKey: () => true }).table).toBe(settled);
    });

    it("applies its edits to translation files held in memory", () => {
        const translations = { "zh-CN": { "ui:a.text": unit("甲"), "ui:b.text": unit("乙") }, ja: { "ui:a.text": unit("あ") } };
        const applied = applyUITextLocaleEdits(translations, {
            "zh-CN": { set: { "ui:c.text": unit("丙") }, remove: ["ui:a.text"] },
        });
        expect(applied["zh-CN"]).toEqual({ "ui:b.text": unit("乙"), "ui:c.text": unit("丙") });
        expect(applied.ja).toBe(translations.ja);
    });
});
