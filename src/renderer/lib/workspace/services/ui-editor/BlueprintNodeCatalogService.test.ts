import { describe, expect, it } from "vitest";
import { BlueprintNodeCatalogService } from "./BlueprintNodeCatalogService";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";

function nodeDef(type: string, displayName = type): BlueprintNodeDef {
    return {
        type,
        displayName,
        category: "Test",
        graphKinds: ["event"],
        isPure: false,
        isLatent: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec" },
            { id: "next", kind: "output", semantic: "exec" },
        ],
        execute: () => ({ nextPort: "next" }),
    };
}

describe("BlueprintNodeCatalogService", () => {
    it("allows same plugin to replace its dynamic select options source", () => {
        const service = new BlueprintNodeCatalogService();
        const sourceId = `test.plugin.${crypto.randomUUID()}.items`;

        const cleanupA = service.registerDynamicSelectOptionsSource(
            sourceId,
            () => [{ value: "a", label: "A" }],
            { ownerPluginId: "test.plugin", replaceExisting: true },
        );
        const cleanupB = service.registerDynamicSelectOptionsSource(
            sourceId,
            () => [{ value: "b", label: "B" }],
            { ownerPluginId: "test.plugin", replaceExisting: true },
        );

        expect(service.getDynamicSelectOptions()[sourceId]).toEqual([{ value: "b", label: "B" }]);

        cleanupA();
        expect(service.getDynamicSelectOptions()[sourceId]).toEqual([{ value: "b", label: "B" }]);

        cleanupB();
        expect(service.getDynamicSelectOptions()[sourceId]).toBeUndefined();
    });

    it("rejects dynamic select options source ownership conflicts", () => {
        const service = new BlueprintNodeCatalogService();
        const sourceId = `test.plugin.${crypto.randomUUID()}.items`;

        service.registerDynamicSelectOptionsSource(
            sourceId,
            () => [],
            { ownerPluginId: "test.plugin", replaceExisting: true },
        );

        expect(() => service.registerDynamicSelectOptionsSource(
            sourceId,
            () => [],
            { ownerPluginId: "other.plugin", replaceExisting: true },
        )).toThrow("prefixed with plugin id");
    });

    it("allows same plugin to replace its blueprint node definitions", () => {
        const service = new BlueprintNodeCatalogService();
        const type = `test.plugin.${crypto.randomUUID()}.node`;

        service.register(nodeDef(type, "First"), {
            ownerPluginId: "test.plugin",
            replaceExisting: true,
        });
        service.register(nodeDef(type, "Second"), {
            ownerPluginId: "test.plugin",
            replaceExisting: true,
        });

        expect(service.get(type)?.displayName).toBe("Second");
    });

    it("rejects plugin blueprint nodes outside the plugin namespace", () => {
        const service = new BlueprintNodeCatalogService();

        expect(() => service.register(nodeDef(`other.plugin.${crypto.randomUUID()}.node`), {
            ownerPluginId: "test.plugin",
            replaceExisting: true,
        })).toThrow("prefixed with plugin id");
    });
});
