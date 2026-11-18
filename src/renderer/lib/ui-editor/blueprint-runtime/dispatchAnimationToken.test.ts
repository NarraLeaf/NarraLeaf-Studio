import { describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "../runtime/types";
import { dispatchBlueprintBroadcastEvent, dispatchBlueprintUiEvent } from "./BlueprintDispatcher";
import { BlueprintExecutionManager } from "./BlueprintExecutionManager";
import { DebugBridge } from "./DebugBridge";

let sequence = 0;

function animationFixture(separateStopLayer = false) {
    const blueprintId = `bp-animation-events-${++sequence}`;
    const animationNodes = {
        down: { id: "down", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN },
        up: { id: "up", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP },
        broadcast: { id: "broadcast", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, params: { event: "stop" } },
        animate: { id: "animate", type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY, params: { duration: 1 } },
        stop: { id: "stop", type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION },
    };
    const animationEdges = [
        { from: { nodeId: "down", port: "then" }, to: { nodeId: "animate", port: "in" } },
        { from: { nodeId: "up", port: "then" }, to: { nodeId: "stop", port: "in" } },
        { from: { nodeId: "animate", port: "animation" }, to: { nodeId: "stop", port: "animation" } },
        { from: { nodeId: "broadcast", port: "then" }, to: { nodeId: "stop", port: "in" } },
    ];
    const main = separateStopLayer
        ? { id: "main", graph: { nodes: { down: animationNodes.down, animate: animationNodes.animate }, edges: animationEdges.slice(0, 1) } }
        : { id: "main", graph: { nodes: animationNodes, edges: animationEdges } };
    const other = { id: "other", graph: {
        nodes: { up: animationNodes.up, animate: animationNodes.animate, stop: animationNodes.stop },
        edges: animationEdges.slice(1, 3),
    } };
    const blueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            [blueprintId]: {
                id: blueprintId, name: "Animation", owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                members: { variables: {}, fields: {}, functions: {} }, bindings: {},
                graphs: { events: separateStopLayer ? { main, other } : { main }, functions: {} },
            },
        },
        ownerRecords: { "widgetMain:surface:button": { blueprintId } },
    } as unknown as BlueprintDocument;
    const document = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc", name: "Doc",
        surfaces: [{ id: "surface", name: "Surface", host: "player", kind: "stageSurface", designSize: { width: 320, height: 180 }, rootElementId: "button", mount: { kind: "slot", slotId: "onStage" } }],
        elements: { button: { id: "button", type: "nl.button", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 100, height: 32 } } },
    } as unknown as UIDocument;
    const pending = new Map<string, (motion: { id: string }) => void>();
    const started: string[] = [];
    const finish = (id: string) => {
        pending.get(id)?.({ id });
        pending.delete(id);
    };
    const stop = vi.fn(async (id: string) => finish(id));
    const hostAdapter = {
        host: "player",
        blueprintRuntime: { hostApi: { widget: {
            getDisplayableProperties: () => ({ position: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, size: { width: 1, height: 1 }, opacity: 1, rotation: 0 }),
            animateDisplayable: (_elementId: string, request: { id: string }) => {
                started.push(request.id);
                return new Promise(resolve => pending.set(request.id, resolve));
            },
            stopDisplayableAnimation: stop,
        } } },
    } as unknown as UIHostAdapter;
    const executionManager = new BlueprintExecutionManager();
    const runtimeScopeId = `scope-${sequence}`;
    const dispatch = (eventName: string) => dispatchBlueprintUiEvent({
        document, blueprintDocument, persistentVariables: {}, surfaceId: "surface", runtimeScopeId, elementId: "button", eventName,
        hostAdapter, debug: new DebugBridge(), executionManager, getSurfaceState: () => undefined, setSurfaceState: () => undefined,
    });
    const broadcast = () => dispatchBlueprintBroadcastEvent({
        document, blueprintDocument, persistentVariables: {}, surfaceId: "surface", runtimeScopeId, eventName: "stop", data: null,
        hostAdapter, debug: new DebugBridge(), executionManager, getSurfaceState: () => undefined, setSurfaceState: () => undefined,
    });
    return { dispatch, broadcast, executionManager, runtimeScopeId, finish, started, stop };
}

describe("animation tokens across widget events", () => {
    it("lets a later mouse-up event stop the animation started on mouse-down", async () => {
        const fixture = animationFixture();
        const down = fixture.dispatch("mouseDown");
        const id = fixture.started[0]!;
        try {
            expect(id).toMatch(/^animation:/);
            await fixture.dispatch("mouseUp");
            expect(fixture.stop).toHaveBeenCalledWith(id);
            await down;
            await fixture.dispatch("mouseUp");
            expect(fixture.stop).toHaveBeenCalledTimes(1);
        } finally {
            fixture.finish(id);
            await down;
        }
    });

    it("exposes an older pending invocation when the newest one finishes", async () => {
        const fixture = animationFixture();
        const first = fixture.dispatch("mouseDown");
        const second = fixture.dispatch("mouseDown");
        const [firstId, secondId] = fixture.started as [string, string];
        try {
            expect(firstId).not.toBe(secondId);
            fixture.finish(secondId);
            await second;
            await fixture.dispatch("mouseUp");
            expect(fixture.stop).toHaveBeenCalledWith(firstId);
        } finally {
            fixture.finish(firstId);
            fixture.finish(secondId);
            await Promise.all([first, second]);
        }
    });

    it("shares the token with a broadcast head in the same authored layer", async () => {
        const fixture = animationFixture();
        const down = fixture.dispatch("mouseDown");
        const id = fixture.started[0]!;
        try {
            await fixture.broadcast();
            expect(fixture.stop).toHaveBeenCalledWith(id);
        } finally {
            fixture.finish(id);
            await down;
        }
    });

    it("stops the animation and removes its pending token when the graph is cancelled", async () => {
        const fixture = animationFixture();
        const down = fixture.dispatch("mouseDown");
        const id = fixture.started[0]!;
        try {
            fixture.executionManager.cancelScope(fixture.runtimeScopeId);
            await down;
            expect(fixture.stop).toHaveBeenCalledOnce();
            expect(fixture.stop).toHaveBeenCalledWith(id);
            await fixture.dispatch("mouseUp");
            expect(fixture.stop).toHaveBeenCalledOnce();
        } finally {
            fixture.finish(id);
            await down;
        }
    });

    it("keeps a matching node id in another layer isolated", async () => {
        const fixture = animationFixture(true);
        const down = fixture.dispatch("mouseDown");
        const id = fixture.started[0]!;
        try {
            await fixture.dispatch("mouseUp");
            expect(fixture.stop).not.toHaveBeenCalled();
        } finally {
            fixture.finish(id);
            await down;
        }
    });
});
