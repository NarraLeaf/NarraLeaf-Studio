/**
 * The screenshot pair and the window-focus reader.
 *
 * What is worth pinning here is the degradation, not the success. Every one of these nodes is on a
 * host that may honestly not be able to do the thing - the web export, a page previewed in Studio -
 * and the shape of that answer has been got wrong before: a node that throws takes the whole graph
 * down over a missing platform feature, and a node that leaves by `Next` with an empty path lets
 * the author's success branch run and show the player a screenshot that was never written.
 *
 * So: absent host means `Failed`, with a reason on `Error`, and never `Next`.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_APP_IS_WINDOW_FOCUSED,
    BLUEPRINT_NODE_TYPE_APP_OPEN_SCREENSHOTS_FOLDER,
    BLUEPRINT_NODE_TYPE_APP_SAVE_SCREENSHOT,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { SCREENSHOT_UNSUPPORTED_MESSAGE } from "@shared/types/blueprint/screenshot";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { createDevModeBlueprintHostApi } from "../../blueprint-runtime/BlueprintHostApiBridge";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";

/**
 * A host adapter over a real bridge.
 *
 * The bridge rather than a hand-written `navigation` object, because the degradation under test is
 * the bridge's: it is what turns "this host passed no `onSaveScreenshot`" into a `failed` result,
 * and a stub that answered for it would be testing the stub.
 */
function hostAdapter(options: Parameters<typeof createDevModeBlueprintHostApi>[0]): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: { hostApi: createDevModeBlueprintHostApi(options) },
    } as unknown as UIHostAdapter;
}

/** The minimum a bridge needs to be built at all; every capability under test is added per case. */
function bridgeOptions(
    extra: Partial<Parameters<typeof createDevModeBlueprintHostApi>[0]> = {},
): Parameters<typeof createDevModeBlueprintHostApi>[0] {
    return {
        document: { surfaces: [], elements: {} },
        scope: { get: () => undefined, set: () => undefined },
        emit: () => undefined,
        activeSurfaceId: "surface",
        runtimeScopeId: "scope",
        widgetRuntimeStore: { get: () => undefined, set: () => undefined, subscribe: () => () => undefined },
        ...extra,
    } as unknown as Parameters<typeof createDevModeBlueprintHostApi>[0];
}

/** One exec node, with its `next` and `failed` branches each writing a local. */
function branchingGraph(nodeType: string): UIGraph {
    return {
        id: "screenshot",
        entries: { main: { start: { nodeId: "act", port: "in" } } },
        nodes: {
            act: { id: "act", type: nodeType, params: {} },
            saved: { id: "saved", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "saved" } },
            failed: { id: "failed", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "failed" } },
        },
        edges: [
            { from: { nodeId: "act", port: "next" }, to: { nodeId: "saved", port: "in" } },
            { from: { nodeId: "act", port: "path" }, to: { nodeId: "saved", port: "value" } },
            { from: { nodeId: "act", port: "failed" }, to: { nodeId: "failed", port: "in" } },
            { from: { nodeId: "act", port: "error" }, to: { nodeId: "failed", port: "value" } },
        ],
    } as unknown as UIGraph;
}

async function run(nodeType: string, adapter: UIHostAdapter): Promise<Record<string, unknown>> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: branchingGraph(nodeType),
        entry: { start: { nodeId: "act", port: "in" } },
        hostAdapter: adapter,
        blueprintLocals: locals,
    });
    return locals;
}

describe("Save Screenshot", () => {
    it("leaves by Failed, naming the platform, on a host that cannot take one", async () => {
        registerCoreBlueprintNodes();

        const locals = await run(BLUEPRINT_NODE_TYPE_APP_SAVE_SCREENSHOT, hostAdapter(bridgeOptions()));

        expect(locals).not.toHaveProperty("saved");
        expect(locals.failed).toBe(SCREENSHOT_UNSUPPORTED_MESSAGE);
    });

    it("leaves by Next with the path the host wrote", async () => {
        registerCoreBlueprintNodes();

        const locals = await run(
            BLUEPRINT_NODE_TYPE_APP_SAVE_SCREENSHOT,
            hostAdapter(bridgeOptions({
                onSaveScreenshot: async () => ({
                    outcome: "saved",
                    path: "/games/Nomen/screenshots/screenshot-20260902-134501-007.png",
                    error: null,
                }),
            })),
        );

        expect(locals.saved).toBe("/games/Nomen/screenshots/screenshot-20260902-134501-007.png");
        expect(locals).not.toHaveProperty("failed");
    });

    it("passes on a write the host refused, rather than throwing", async () => {
        registerCoreBlueprintNodes();

        const locals = await run(
            BLUEPRINT_NODE_TYPE_APP_SAVE_SCREENSHOT,
            hostAdapter(bridgeOptions({
                onSaveScreenshot: async () => ({ outcome: "failed", path: null, error: "disk full" }),
            })),
        );

        expect(locals).not.toHaveProperty("saved");
        expect(locals.failed).toBe("disk full");
    });
});

describe("Open Screenshots Folder", () => {
    it("leaves by Failed on a host with no folder to show", async () => {
        registerCoreBlueprintNodes();

        const locals = await run(
            BLUEPRINT_NODE_TYPE_APP_OPEN_SCREENSHOTS_FOLDER,
            hostAdapter(bridgeOptions()),
        );

        expect(locals).not.toHaveProperty("saved");
        expect(locals.failed).toBe(SCREENSHOT_UNSUPPORTED_MESSAGE);
    });

    it("reports the folder it opened", async () => {
        registerCoreBlueprintNodes();

        const locals = await run(
            BLUEPRINT_NODE_TYPE_APP_OPEN_SCREENSHOTS_FOLDER,
            hostAdapter(bridgeOptions({
                onOpenScreenshotsFolder: async () => ({
                    outcome: "opened",
                    path: "/games/Nomen/screenshots",
                    error: null,
                }),
            })),
        );

        expect(locals.saved).toBe("/games/Nomen/screenshots");
    });
});

describe("Is Window Focused", () => {
    /** The reader writes its one output pin into a local. */
    async function readFocus(adapter: UIHostAdapter): Promise<unknown> {
        const locals: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "focus",
                entries: { main: { start: { nodeId: "read", port: "in" } } },
                nodes: {
                    read: { id: "read", type: BLUEPRINT_NODE_TYPE_APP_IS_WINDOW_FOCUSED, params: {} },
                    store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "focused" } },
                },
                edges: [
                    { from: { nodeId: "read", port: "next" }, to: { nodeId: "store", port: "in" } },
                    { from: { nodeId: "read", port: "isFocused" }, to: { nodeId: "store", port: "value" } },
                ],
            } as unknown as UIGraph,
            entry: { start: { nodeId: "read", port: "in" } },
            hostAdapter: adapter,
            blueprintLocals: locals,
        });
        return locals.focused;
    }

    it("answers what the host says", async () => {
        registerCoreBlueprintNodes();

        expect(await readFocus(hostAdapter(bridgeOptions({ onIsWindowFocused: () => false })))).toBe(false);
        expect(await readFocus(hostAdapter(bridgeOptions({ onIsWindowFocused: () => true })))).toBe(true);
    });

    it("answers true where the host has no window to be behind", async () => {
        // A panel drawn inside Studio is being looked at whenever it is drawn. Answering false there
        // would let a graph written against this silence a game that is on screen.
        registerCoreBlueprintNodes();

        expect(await readFocus(hostAdapter(bridgeOptions()))).toBe(true);
    });
});
