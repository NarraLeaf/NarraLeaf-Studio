/**
 * A blueprint node that throws inside a Game UI slot surface has to reach the author.
 *
 * It did not. The skeleton template's quick menu had an Auto button whose graph called
 * `game.setPreference`, and the slot's host callback threw "game runtime is not available" every
 * time it was pressed. The Dev Mode window said "Nothing has failed", the console said nothing, and
 * the button simply did not work: the `execution.error` went into the debug stream, was forwarded
 * over IPC to the *Workspace* console in the other window, and nothing in the window the author was
 * looking at ever read it.
 *
 * So this walks the real path end to end - the real slot-scoped host API, the real host adapter, a
 * real click dispatch - and then hands what the stream produced to the Dev Mode host's own mapping,
 * which is the half that was missing.
 */
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle } from "@shared/types/devMode";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIStageSurface } from "@shared/types/ui-editor/document";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import {
    appendRuntimeIssue,
    blueprintDebugEventIssue,
    locateRuntimeIssue,
    type LocatedRuntimeIssue,
    type StoryRowBundle,
} from "@/apps/dev-mode/components/runtimeIssueModel";
import { stageSlotRuntimeScopeId } from "./stageSlots";

const SURFACE_ID = "quick-menu";
const BUTTON_ID = "auto-button";
const BLUEPRINT_ID = "bp-quick-menu-auto";
/** Word for word what the slot's host callback threw before `sessionGate` was introduced. */
const HOST_FAILURE = "Set autoForward Preference: game runtime is not available";

const surface: UIStageSurface = {
    id: SURFACE_ID,
    name: "Quick Menu",
    host: "player",
    kind: "stageSurface",
    designSize: { width: 1920, height: 1080 },
    rootElementId: "root",
    mount: { kind: "slot", slotId: "onStage" },
} as unknown as UIStageSurface;

const uidoc: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: {
            id: "root",
            type: "nl.root",
            parentId: null,
            childrenIds: [BUTTON_ID],
            layout: { x: 0, y: 0, width: 1920, height: 1080 },
        },
        [BUTTON_ID]: {
            id: BUTTON_ID,
            type: "nl.button",
            parentId: "root",
            childrenIds: [],
            layout: { x: 0, y: 0, width: 120, height: 40 },
        },
    },
} as unknown as UIDocument;

/** The button's private blueprint: click → Set Auto Forward, which is all the skeleton's is. */
const localBlueprints: BlueprintDocument = {
    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    blueprints: {
        [BLUEPRINT_ID]: {
            id: BLUEPRINT_ID,
            name: "Auto Button",
            owner: { kind: "widgetMain", surfaceId: SURFACE_ID, elementId: BUTTON_ID },
            frontend: "visual",
            programKind: "graph",
            members: { variables: {}, fields: {}, functions: {} },
            bindings: {},
            program: {
                kind: "graph",
                graphs: {
                    events: {
                        mouseClick: {
                            id: "mouseClick",
                            graph: {
                                nodes: {
                                    head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                                    setAuto: { id: "setAuto", type: BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD },
                                },
                                edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "setAuto", port: "in" } }],
                            },
                        },
                    },
                    functions: {},
                },
            },
        },
    },
    ownerRecords: {
        [`widgetMain:${SURFACE_ID}:${BUTTON_ID}`]: {
            activeBlueprintId: BLUEPRINT_ID,
            privateBlueprintIds: [BLUEPRINT_ID],
            initializedFrontend: "visual",
        },
    },
} as unknown as BlueprintDocument;

const bundle = {
    ui: { uidoc, localBlueprints, persistentVariables: {}, savedVariables: {} },
} as unknown as DevModeBundle;

/** What the Dev Mode host reads a surface name out of; it has no story here, and needs none. */
const issueBundle: StoryRowBundle = {
    ui: { uidoc, persistentVariables: {}, savedVariables: {} },
} as unknown as StoryRowBundle;

/**
 * Press the button on a slot surface, wired exactly as `StageSlotSurfaceShell` wires one: the host
 * API and the adapter both scoped to `nlr:<session>:slot:<slotId>:<surfaceId>`, both emitting into
 * the session's one debug bridge.
 */
async function clickAutoButtonOnSlotSurface(): Promise<BlueprintDebugEvent[]> {
    const debug = new DebugBridge();
    const scopeBridge = new ScopeStoreBridge();
    const runtimeScopeId = stageSlotRuntimeScopeId("session-1", "onStage", SURFACE_ID);

    const hostApi = createDevModeBlueprintHostApi({
        document: uidoc,
        scope: scopeBridge,
        activeSurfaceId: SURFACE_ID,
        runtimeScopeId,
        pageProps: {},
        emit: event => debug.emit(event),
        onOpenSurface: () => undefined,
        onCloseLayer: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
        onSetGamePreference: () => {
            throw new Error(HOST_FAILURE);
        },
    });

    const adapter = createDevModeBlueprintHostAdapter({
        bundle,
        surface,
        runtimeScopeId,
        scopeBridge,
        debug,
        hostApi,
    });

    await adapter.blueprintRuntime?.dispatchElementBlueprintEvent(BUTTON_ID, "mouseClick", {
        element: { surfaceId: SURFACE_ID, elementId: BUTTON_ID, elementType: "nl.button" },
    });

    return debug.snapshot();
}

describe("a blueprint failure on a Game UI slot surface", () => {
    it("reports the failure, and says which surface it happened on", async () => {
        const events = await clickAutoButtonOnSlotSurface();

        const errors = events.filter(event => event.type === "execution.error");
        expect(errors.length).toBeGreaterThan(0);
        for (const error of errors) {
            expect(error).toMatchObject({ message: HOST_FAILURE, surfaceId: SURFACE_ID });
        }
    });

    it("becomes an issue in the list the Dev Mode window shows", async () => {
        const events = await clickAutoButtonOnSlotSurface();

        // The mapping the Dev Mode host runs every debug event through. Before this existed the
        // stream ended at an IPC forward and the panel said "Nothing has failed".
        let issues: readonly LocatedRuntimeIssue[] = [];
        events.forEach((event, index) => {
            const reported = blueprintDebugEventIssue(event);
            if (reported) {
                issues = appendRuntimeIssue(issues, locateRuntimeIssue(issueBundle, reported, `issue-${index}`));
            }
        });

        // One entry, not one per emit: the executor reports the failing node and the dispatcher
        // reports the same failure again on its way out, and an author has one problem either way.
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
            level: "error",
            message: HOST_FAILURE,
            origin: "interface",
            // No story row to point at - an interface graph is not written on one - so the place it
            // names is the surface, under the name the author gave it.
            location: null,
            surface: { surfaceId: SURFACE_ID, surfaceName: "Quick Menu" },
        });
    });

    it("keeps two surfaces failing the same way apart", () => {
        const onQuickMenu = locateRuntimeIssue(
            issueBundle,
            { level: "error", message: HOST_FAILURE, origin: "interface", surfaceId: SURFACE_ID },
            "issue-1",
        );
        const onSettings = locateRuntimeIssue(
            issueBundle,
            { level: "error", message: HOST_FAILURE, origin: "interface", surfaceId: "settings" },
            "issue-2",
        );

        // Same sentence, different surface: two problems. Collapsing them by message alone would
        // hide the second one, which is the failure mode this whole channel exists to end.
        expect(appendRuntimeIssue(appendRuntimeIssue([], onQuickMenu), onSettings)).toHaveLength(2);
    });
});
