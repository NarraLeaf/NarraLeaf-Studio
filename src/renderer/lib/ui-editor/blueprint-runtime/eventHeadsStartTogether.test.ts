import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { dispatchGlobalBlueprintEvent, dispatchSurfaceBlueprintEvent } from "./BlueprintDispatcher";
import { acquireBlueprintExecutionLocals } from "./blueprintWidgetLocals";
import { DebugBridge } from "./DebugBridge";
import { startTogether } from "./startTogether";

/**
 * Blueprints are event driven: an event is a broadcast, and every head listening for it starts at
 * once. They used to run one after another in node-id order, so a chain that waited held back every
 * chain whose head sorted after it - a splash on `On Game Ready` with a Delay kept a sound on another
 * `On Game Ready` head silent for the length of the splash, or not, depending on two random ids.
 */

const KEEP_WINDOW_OPEN = "blueprint.app.keepWindowOpen";

/** Variable stores live as long as the module, keyed by blueprint, so every case names its own. */
let nextBlueprint = 0;

type Chain = Record<string, { id: string; type: string; params?: Record<string, unknown> }>;

/**
 * A blueprint with one layer holding every chain given. Head ids are the chains' keys, so the order
 * they sort in is the order the old dispatcher would have run them in.
 */
function blueprintWith(owner: "global" | "surface", chains: Array<{ head: string; headType: string; then: Chain; edges: Array<[string, string, string]> }>): { blueprintDocument: BlueprintDocument; id: string } {
    const nodes: Chain = {};
    const edges: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }> = [];
    for (const chain of chains) {
        nodes[chain.head] = { id: chain.head, type: chain.headType };
        Object.assign(nodes, chain.then);
        for (const [from, port, to] of chain.edges) {
            edges.push({ from: { nodeId: from, port }, to: { nodeId: to, port: "in" } });
        }
    }
    nextBlueprint += 1;
    const id = `bp-${owner}-${nextBlueprint}`;
    const blueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            [id]: {
                id,
                name: "Logic",
                owner: owner === "global" ? { kind: "globalMain" } : { kind: "surfaceMain", surfaceId: "surface" },
                members: {
                    variables: {
                        early: { id: "early", name: "early", valueType: "string", defaultValue: "" },
                        late: { id: "late", name: "late", valueType: "string", defaultValue: "" },
                    },
                    fields: {},
                    functions: {},
                },
                bindings: {},
                graphs: { events: { main: { id: "main", graph: { nodes, edges } } }, functions: {} },
            },
        },
        ownerRecords: owner === "global"
            ? { globalMain: { blueprintId: id } }
            : { "surfaceMain:surface": { blueprintId: id } },
    } as BlueprintDocument;
    return { blueprintDocument, id };
}

function set(id: string, variableId: string): Chain {
    return { [id]: { id, type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId, value: "yes" } } };
}

function delay(id: string, seconds: number): Chain {
    return { [id]: { id, type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: seconds } } };
}

function localsOf(made: { blueprintDocument: BlueprintDocument; id: string }, owner: "global" | "surface"): Record<string, unknown> {
    return owner === "global"
        ? acquireBlueprintExecutionLocals({ blueprintDocument: made.blueprintDocument, currentBlueprintId: made.id })
        : acquireBlueprintExecutionLocals({ blueprintDocument: made.blueprintDocument, currentBlueprintId: made.id, surfaceId: "surface" });
}

/** Execution start and finish are verbose events, which the bridge keeps only when asked to. */
function tracingBridge(): DebugBridge {
    const debug = new DebugBridge();
    debug.setVerboseCaptureEnabled(true);
    return debug;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hostAdapter: UIHostAdapter = { host: "player" };

describe("the heads of one event start together", () => {
    it("starts a head that sorts after a waiting one before the wait is over, and settles after the longer", async () => {
        // `aSplash` sorts first and waits; `bSound` would have run only once that wait was over.
        const made = blueprintWith("global", [
            {
                head: "aSplash",
                headType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
                then: { ...delay("wait", 0.3), ...set("setLate", "late") },
                edges: [["aSplash", "then", "wait"], ["wait", "completed", "setLate"]],
            },
            {
                head: "bSound",
                headType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
                then: set("setEarly", "early"),
                edges: [["bSound", "then", "setEarly"]],
            },
        ]);
        const startedAt = Date.now();
        let settledAt: number | null = null;
        const dispatched = dispatchGlobalBlueprintEvent({
            blueprintDocument: made.blueprintDocument,
            persistentVariables: {},
            eventName: "gameReady",
            hostAdapter,
            debug: new DebugBridge(),
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        }).then(() => {
            settledAt = Date.now();
        });

        await wait(60);
        expect(localsOf(made, "global").early).toBe("yes");
        expect(localsOf(made, "global").late).toBe("");
        // A host awaiting the event - the boot, for On Game Ready - is still waiting.
        expect(settledAt).toBeNull();

        await dispatched;
        expect(localsOf(made, "global").late).toBe("yes");
        expect(settledAt! - startedAt).toBeGreaterThanOrEqual(250);
    });

    it("keeps the other heads running when one fails, and reports the failure as one head's", async () => {
        // `aBroken` fails on its first node (Keep Window Open answers only a close request); the old
        // dispatcher stopped there and `bWorks` never ran.
        const made = blueprintWith("surface", [
            {
                head: "aBroken",
                headType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
                then: { keep: { id: "keep", type: KEEP_WINDOW_OPEN } },
                edges: [["aBroken", "then", "keep"]],
            },
            {
                head: "bWorks",
                headType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
                then: { ...delay("wait", 0.05), ...set("setLate", "late") },
                edges: [["bWorks", "then", "wait"], ["wait", "completed", "setLate"]],
            },
        ]);
        const debug = tracingBridge();

        await dispatchSurfaceBlueprintEvent({
            blueprintDocument: made.blueprintDocument,
            persistentVariables: {},
            surfaceId: "surface",
            eventName: "surfaceInit",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(localsOf(made, "surface").late).toBe("yes");
        const lifecycle = debug.snapshot().filter(event => event.type.startsWith("execution."));
        const errors = lifecycle.filter(event => event.type === "execution.error");
        // Reported where a lone failing head is: the executor's own report and the dispatcher's.
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.every(event => "nodeId" in event && event.nodeId === "keep")).toBe(true);
        expect(errors.every(event => "surfaceId" in event && event.surfaceId === "surface")).toBe(true);
        // One execution, and it did not finish cleanly.
        expect(lifecycle.filter(event => event.type === "execution.started")).toHaveLength(1);
        expect(lifecycle.some(event => event.type === "execution.finished")).toBe(false);
    });

    it("leaves a lone head exactly as it was: started at once, finished once", async () => {
        const made = blueprintWith("global", [
            {
                head: "only",
                headType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
                then: set("setEarly", "early"),
                edges: [["only", "then", "setEarly"]],
            },
        ]);
        const debug = tracingBridge();
        await dispatchGlobalBlueprintEvent({
            blueprintDocument: made.blueprintDocument,
            persistentVariables: {},
            eventName: "gameReady",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });
        expect(localsOf(made, "global").early).toBe("yes");
        expect(debug.snapshot().filter(event => event.type.startsWith("execution.")).map(event => event.type))
            .toEqual(["execution.started", "execution.finished"]);
    });
});

describe("startTogether", () => {
    it("starts every task before any of them has finished waiting", async () => {
        const started: string[] = [];
        let releaseFirst = () => undefined as void;
        const first = new Promise<void>(resolve => { releaseFirst = resolve; });
        const settled = startTogether([
            async () => { started.push("a"); await first; return "a"; },
            async () => { started.push("b"); return "b"; },
        ]);
        expect(started).toEqual(["a", "b"]);
        releaseFirst();
        expect((await settled).map(outcome => outcome.status === "fulfilled" ? outcome.value : null)).toEqual(["a", "b"]);
    });

    it("hands back each failure in the position it was given, and runs the rest", async () => {
        const ran: string[] = [];
        const outcomes = await startTogether([
            () => { throw new Error("sync"); },
            async () => { ran.push("b"); },
            async () => { throw new Error("async"); },
        ]);
        expect(ran).toEqual(["b"]);
        expect(outcomes.map(outcome => outcome.status)).toEqual(["rejected", "fulfilled", "rejected"]);
        expect(outcomes[0]!.status === "rejected" && (outcomes[0]!.reason as Error).message).toBe("sync");
    });
});
