import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";

/** A widget inserted into a project gets its words in the project's source language, wherever it is inserted. */

function createHarness(sourceLocale: string | null) {
    let nextId = 0;
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
                        if (sourceLocale === null) {
                            throw new Error("No localization service");
                        }
                        return { getConfiguration: () => ({ sourceLocale, locales: [{ code: sourceLocale }] }), getKeysIfLoaded: () => undefined };
                    default:
                        throw new Error(`Unexpected service ${serviceId}`);
                }
            },
        } as any,
        commandLineRun: false,
    });
    (service as any).document = (service as any).createEmptyDocument();
    return { service, rootId: service.getDocument().surfaces[0].rootElementId };
}

// Loading every built-in widget module is slow on a cold run.
beforeAll(async () => {
    await ensureWidgetModulesRegistered();
}, 120_000);

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("inserting a widget", () => {
    it("gives a text and a button words in the project's source language, names in the interface's", () => {
        const { service, rootId } = createHarness("zh");
        const text = service.createElement(rootId, "nl.text");
        const button = service.createElement(rootId, "nl.button");
        expect(text.props?.text).toBe("文本");
        expect(text.name).toBe("Text");
        expect(button.props?.label).toBe("按钮");
    });

    it("follows the project, not the interface", () => {
        i18nStore.setLocale("zh");
        const { service, rootId } = createHarness("en");
        expect(service.createElement(rootId, "nl.text").props?.text).toBe("Text");
    });

    it("keeps the interface's language where the project names no language Studio can write in", () => {
        i18nStore.setLocale("ja");
        const korean = createHarness("ko");
        expect(korean.service.createElement(korean.rootId, "nl.text").props?.text).toBe("テキスト");
        const bare = createHarness(null);
        expect(bare.service.createElement(bare.rootId, "nl.text").props?.text).toBe("テキスト");
    });
});
