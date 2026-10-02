import { describe, expect, it, vi } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { i18nStore } from "@/lib/i18n";
import { Services } from "../services";
import { UIGraphService } from "./UIGraphService";

/**
 * What the workspace says about a graphs file a newer Studio has already saved.
 *
 * The blueprint document inside it carries its own version, and the migration that reads it names
 * the oldest version it accepts when it refuses one - so a project opened by a newer Studio was
 * reported as though it were too old. The refusal names both versions instead, in the sentence every
 * other reader of a too-new project file uses.
 */

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: {} }),
}));

function migrate(document: unknown): unknown {
    const service = new UIGraphService();
    service.setContext({
        project: { resolve: (...parts: string[]) => ["/p", ...parts].join("/") },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Uuid) {
                    return { generate: () => "generated" };
                }
                throw new Error(`Unexpected service ${String(serviceId)}`);
            },
        },
    } as never);
    return (service as never as { migrateIfNeeded(document: unknown): unknown }).migrateIfNeeded(document);
}

describe("a graphs file from a newer Studio", () => {
    it("names both versions for a blueprint document past this build's", () => {
        i18nStore.setLocale("en");
        const newer = BLUEPRINT_DOCUMENT_SCHEMA_VERSION + 1;
        expect(() => migrate({
            schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            blueprintDocument: { schemaVersion: newer, blueprints: {}, ownerRecords: {} },
        })).toThrow(
            `editor/ui/uigraphs.json was written by a newer NarraLeaf Studio (blueprint format v${newer});`
            + ` this build reads up to v${BLUEPRINT_DOCUMENT_SCHEMA_VERSION}`,
        );
    });

    it("names both versions for the file's own envelope", () => {
        i18nStore.setLocale("en");
        const newer = UI_GRAPH_DOCUMENT_SCHEMA_VERSION + 1;
        expect(() => migrate({ schemaVersion: newer })).toThrow(
            `editor/ui/uigraphs.json was written by a newer NarraLeaf Studio (interface blueprint format v${newer});`
            + ` this build reads up to v${UI_GRAPH_DOCUMENT_SCHEMA_VERSION}`,
        );
    });
});
