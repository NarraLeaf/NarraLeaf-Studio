import { describe, expect, it } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";

/**
 * Opening a document older than v13: the step runs against the project's own keys and translation
 * files, and the translation edits it makes are written through the localization service before the
 * document is - so a save of the document that fails leaves a project that is migrated again, the same
 * way, on the next open.
 */

const unit = (target: string): LocalizationUnit => ({ target, sourceHash: "fnv1a:1", status: "translated" });

function v12Document(): UIDocument {
    const layout = { x: 0, y: 0, width: 10, height: 10 };
    return {
        schemaVersion: 12,
        id: "doc",
        name: "UI",
        surfaces: [{
            id: "page",
            name: "Title",
            host: "app",
            kind: "appSurface",
            designSize: { width: 10, height: 10 },
            rootElementId: "root",
        }],
        elements: {
            root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["start", "continue"], layout },
            start: { id: "start", type: "nl.button", parentId: "root", childrenIds: [], layout, props: { label: "Start", localizationKey: "menu.start" } },
            continue: { id: "continue", type: "nl.button", parentId: "root", childrenIds: [], layout, props: { label: "Continue", localizationKey: "menu.continue" } },
        },
    };
}

function createService(options: { unreadableKeys?: boolean } = {}) {
    const calls: string[] = [];
    const documents: Record<string, Record<string, LocalizationUnit>> = {
        "zh-CN": { "key:menu.continue": unit("继续") },
    };
    const localization = {
        getConfiguration: () => ({
            sourceLocale: "en",
            locales: [{ code: "en", displayName: "English" }, { code: "zh-CN", displayName: "简体中文" }],
        }),
        loadKeys: async () => {
            if (options.unreadableKeys) {
                throw new Error("keys.json could not be read");
            }
            return { schemaVersion: 1, keys: { "menu.start": { sourceText: "Start" } } };
        },
        loadDocument: async (locale: string) => ({ schemaVersion: 1, locale, units: documents[locale] ?? {} }),
        applyUnitEdits: (locale: string, edit: { set: Record<string, LocalizationUnit>; remove: string[] }) => {
            calls.push(`edit ${locale}`);
            const units = { ...documents[locale] };
            for (const unitId of edit.remove) {
                delete units[unitId];
            }
            documents[locale] = { ...units, ...edit.set };
        },
        flushPendingChanges: async () => {
            calls.push("flush");
        },
    };
    const service = new UIDocumentService();
    service.setContext({
        project: { resolve: (name: string) => name } as never,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Localization) {
                    return localization;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as never,
        commandLineRun: false,
    });
    const migrate = (document: UIDocument): Promise<UIDocument> =>
        (service as unknown as { migrateTextSources(document: UIDocument): Promise<UIDocument> }).migrateTextSources(document);
    return { migrate, calls, documents };
}

describe("UIDocumentService opening a document older than v13", () => {
    it("migrates against the project's keys and writes the translation edits first", async () => {
        const { migrate, calls, documents } = createService();
        const migrated = await migrate(v12Document());

        expect(migrated.schemaVersion).toBe(13);
        expect(migrated.elements.start.props).toEqual({ localizationKey: "menu.start" });
        expect(migrated.elements.continue.props).toEqual({ label: "Continue" });
        expect(documents["zh-CN"]["ui:continue.label"]).toEqual(unit("继续"));
        expect(calls).toEqual(["edit zh-CN", "flush"]);
    });

    it("leaves a current document to the ordinary path", async () => {
        const { migrate, calls } = createService();
        const current = { ...v12Document(), schemaVersion: 13 };
        expect(await migrate(current)).toBe(current);
        expect(calls).toEqual([]);
    });

    it("stops rather than reading an unreadable key registry as an empty one", async () => {
        const { migrate, documents } = createService({ unreadableKeys: true });
        await expect(migrate(v12Document())).rejects.toThrow(/keys\.json/);
        expect(documents["zh-CN"]["ui:continue.label"]).toBeUndefined();
    });
});
