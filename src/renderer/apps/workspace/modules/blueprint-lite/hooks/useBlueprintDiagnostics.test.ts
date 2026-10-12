// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { i18nStore } from "@/lib/i18n";
import { useBlueprintDiagnostics } from "./useBlueprintDiagnostics";

/** A widget blueprint whose integer variable is wired into a json input: one type mismatch. */
function mismatchedDocument(): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            widget: {
                id: "widget",
                name: "Widget",
                owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                members: { variables: {}, fields: {}, functions: {} },
                graphs: {
                    events: {
                        init: {
                            id: "init",
                            graph: {
                                nodes: {
                                    declare: {
                                        id: "declare",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: { variableId: "score", name: "Score", valueType: "integer", defaultValue: 0 },
                                    },
                                    get: { id: "get", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "score" } },
                                    format: { id: "format", type: BLUEPRINT_NODE_TYPE_STRING_FORMAT },
                                },
                                edges: [{ from: { nodeId: "get", port: "value" }, to: { nodeId: "format", port: "values" } }],
                            },
                        },
                    },
                    functions: {},
                },
            },
        },
        ownerRecords: {},
    } as unknown as BlueprintDocument;
}

const mismatchMessage = (diagnostics: readonly { code?: string; message: string }[]) =>
    diagnostics.find(d => d.code === "edge.connection_invalid")?.message;

describe("useBlueprintDiagnostics", () => {
    afterEach(() => {
        act(() => i18nStore.setLocale("en"));
    });

    it("says its findings again in the interface language when the language changes", () => {
        registerCoreBlueprintNodes();
        act(() => i18nStore.setLocale("en"));
        const doc = mismatchedDocument();
        const { result } = renderHook(() => useBlueprintDiagnostics(doc, "widget", 0));
        expect(mismatchMessage(result.current)).toContain("Type mismatch");

        act(() => i18nStore.setLocale("zh"));
        expect(mismatchMessage(result.current)).toContain("类型不匹配");
        expect(mismatchMessage(result.current)).not.toContain("Type mismatch");
    });
});
