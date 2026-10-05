import { describe, expect, it } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import type { UIComponentDefinition, UIElement } from "@shared/types/ui-editor/document";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";

/**
 * A copy of a widget whose words are written directly keeps their translations: the copy's own unit
 * (`ui:<copyId>.<prop>`) receives what the original's says in every language the project declares -
 * from the clipboard when the copy came from elsewhere, from the project's own files when it did not.
 */

type Units = Record<string, LocalizationUnit>;

function unit(target: string, status: LocalizationUnit["status"] = "translated"): LocalizationUnit {
    return { target, sourceHash: "fnv1a:0001", status };
}

/** The localization service as far as a paste reaches: languages, keys, and per-language units. */
function fakeLocalization(onDisk: Record<string, Units>, locales = ["zh", "en", "ja"]) {
    const loaded = new Map<string, { units: Units }>();
    return {
        loaded,
        getConfiguration: () => ({ sourceLocale: "zh", locales: locales.map(code => ({ code, displayName: code })) }),
        getKeysIfLoaded: () => ({ schemaVersion: 1, keys: { "menu.start": { sourceText: "开始" } } }),
        getDocumentIfLoaded: (locale: string) => loaded.get(locale),
        loadDocument: async (locale: string) => {
            if (!loaded.has(locale)) {
                loaded.set(locale, { units: { ...(onDisk[locale] ?? {}) } });
            }
            return loaded.get(locale)!;
        },
        adoptUnits: (locale: string, units: Units) => {
            const document = loaded.get(locale)!;
            for (const [unitId, value] of Object.entries(units)) {
                document.units[unitId] ??= value;
            }
        },
        applyUnitEdits: (locale: string, edit: { set: Units; remove: string[] }) => {
            Object.assign(loaded.get(locale)!.units, edit.set);
        },
    };
}

function createHarness(onDisk: Record<string, Units>, locales?: string[]) {
    let nextId = 0;
    const localization = fakeLocalization(onDisk, locales);
    const service = new UIDocumentService();
    service.setContext({
        project: { resolve: (name: string) => name } as any,
        services: {
            get(serviceId: Services) {
                switch (serviceId) {
                    case Services.Uuid:
                        return { generate: () => `gen-${++nextId}` };
                    case Services.Project:
                        return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                    case Services.LocalBlueprint:
                        return { applyBlueprintMutation: () => undefined, getBlueprintDocument: () => ({ blueprints: {}, ownerRecords: {} }) };
                    case Services.Localization:
                        return localization;
                    case Services.WorkspaceFreeze:
                        return { isFrozen: () => false };
                    default:
                        throw new Error(`Unexpected service ${serviceId}`);
                }
            },
        } as any,
        commandLineRun: false,
    });
    (service as any).document = (service as any).createEmptyDocument();
    const surfaceId = service.getDocument().surfaces[0].id;
    const rootId = service.getDocument().surfaces[0].rootElementId;
    return { service, localization, surfaceId, rootId };
}

function button(id: string, props: Record<string, unknown>, extra?: Record<string, unknown>): UIElement {
    return {
        id,
        type: "nl.button",
        name: "Adventure",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
        props,
        ...(extra ? { extra } : {}),
    };
}

function payloadOf(surfaceId: string, copied: UIElement, more: Partial<UIEditorClipboardPayload> = {}): UIEditorClipboardPayload {
    return {
        v: 1,
        sourceSurfaceId: surfaceId,
        topLevelElementIds: [copied.id],
        elements: { [copied.id]: copied },
        widgetMainBlueprints: {},
        widgetValueBlueprints: {},
        ...more,
    };
}

/** Let the asynchronous carry finish. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

describe("copying a widget whose words are written directly", () => {
    it("gives the copy, within the project, the original's translations under its own unit", async () => {
        const { service, localization, surfaceId, rootId } = createHarness({
            en: { "ui:source.label": unit("Begin the adventure") },
            ja: { "ui:source.label": unit("冒険を始める", "reviewed") },
        });
        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payloadOf(surfaceId, button("source", { label: "开始冒险" })));
        await settle();

        expect(result.ok).toBe(true);
        const [copyId] = result.ok ? result.newRootIds : [];
        expect(localization.loaded.get("en")?.units[`ui:${copyId}.label`]?.target).toBe("Begin the adventure");
        expect(localization.loaded.get("ja")?.units[`ui:${copyId}.label`]).toEqual({
            target: "冒険を始める",
            sourceHash: "fnv1a:0001",
            // A review is a sign-off on the original; nobody has signed off on the copy.
            status: "translated",
        });
        expect(localization.loaded.get("en")?.units["ui:source.label"]?.target).toBe("Begin the adventure");
    });

    it("writes what the clipboard carried, in the languages this project declares only", async () => {
        const { service, localization, surfaceId, rootId } = createHarness({}, ["zh", "en"]);
        const payload = payloadOf(surfaceId, button("elsewhere", { label: "开始冒险" }), {
            translations: {
                en: { "ui:elsewhere.label": unit("Begin the adventure") },
                ja: { "ui:elsewhere.label": unit("冒険を始める") },
            },
        });
        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payload);
        await settle();

        const [copyId] = result.ok ? result.newRootIds : [];
        expect(localization.loaded.get("en")?.units[`ui:${copyId}.label`]?.target).toBe("Begin the adventure");
        expect(localization.loaded.has("ja")).toBe(false);
    });

    it("carries nothing for a widget whose words come from a key the project has", async () => {
        const { service, localization, surfaceId, rootId } = createHarness({ en: { "ui:keyed.label": unit("Stale leftover") } });
        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payloadOf(surfaceId, button("keyed", { localizationKey: "menu.start" })));
        await settle();

        const [copyId] = result.ok ? result.newRootIds : [];
        expect(localization.loaded.get("en")?.units[`ui:${copyId}.label`]).toBeUndefined();
    });

    it("carries a placement's directly written parameter value, under the copy's own unit", async () => {
        const { service, localization, surfaceId, rootId } = createHarness({ en: { "ui:nav-1.param.label": unit("Begin") } });
        const component: UIComponentDefinition = {
            id: "nav",
            name: "Nav item",
            rootElementId: "nav-root",
            params: [{ id: "label", name: "Label", type: "text", defaultValue: "Item" }],
            elements: { "nav-root": button("nav-root", { label: "Sample" }) },
        };
        service.getDocument().components = [component];
        const placement: UIElement = {
            ...button("nav-1", {}, { componentLink: { componentId: "nav", linked: true, params: { label: "开始" } } }),
            type: "nl.container",
        };
        const result = service.pasteClipboardPayload(surfaceId, rootId, null, payloadOf(surfaceId, placement));
        await settle();

        const [copyId] = result.ok ? result.newRootIds : [];
        expect(localization.loaded.get("en")?.units[`ui:${copyId}.param.label`]?.target).toBe("Begin");
    });
});

describe("duplicating a page", () => {
    it("gives every copied widget the translations of the one it copies", async () => {
        const { service, localization, surfaceId, rootId } = createHarness({ en: { "ui:title.text": unit("Your Game") } });
        const document = service.getDocument();
        document.elements.title = {
            id: "title",
            type: "nl.text",
            name: "Title",
            parentId: rootId,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
            props: { text: "你的游戏" },
        };
        document.elements[rootId].childrenIds.push("title");
        const copy = service.duplicateSurface(surfaceId, "Copy");
        await settle();

        const copiedTitle = Object.values(service.getDocument().elements)
            .find(element => element.type === "nl.text" && element.id !== "title" && element.props?.text === "你的游戏");
        expect(copy).not.toBeNull();
        expect(copiedTitle).toBeDefined();
        expect(localization.loaded.get("en")?.units[`ui:${copiedTitle!.id}.text`]?.target).toBe("Your Game");
    });
});
