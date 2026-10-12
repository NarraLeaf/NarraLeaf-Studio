/**
 * `Post Notification`, held to the stream its reader reads.
 *
 * The node is only worth having if what it posts is the same thing the engine's own notices are:
 * drawn by the project's Notifications surface, and listed by `Get Notifications` until it closes.
 * So the host here is the real bridge over the real live-game callbacks, with only the `LiveGame`
 * faked - a `notify` that queues into the manager `getGameState().notificationMgr` hands back, the
 * shape the engine has. A stub that answered `postNotification` itself would be testing the stub.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import {
    BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS,
    BLUEPRINT_NODE_TYPE_GAME_POST_NOTIFICATION,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { createChoiceMenus } from "@/lib/ui-editor/runtime/app/choiceMenus";
import { createDialogClickTargets } from "@/lib/ui-editor/runtime/app/dialogClickTargets";
import { createLiveGameUiCallbacks } from "@/lib/ui-editor/runtime/app/gameUiSlots";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { createDevModeBlueprintHostApi } from "../../blueprint-runtime/BlueprintHostApiBridge";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";

type BridgeOptions = Parameters<typeof createDevModeBlueprintHostApi>[0];

/** What the fake engine was asked to show, in the order it was asked. */
type NotifyCall = { message: string; durationMs: number | undefined; argumentCount: number };

/**
 * A `LiveGame` reduced to its notification channel: `notify` queues into a manager whose `toArray`
 * is what the live-game callbacks read for `Get Notifications`.
 */
function fakeLiveGame(): { liveGame: LiveGame; calls: NotifyCall[] } {
    const queue: Array<{ id: string; message: string; duration: number }> = [];
    const calls: NotifyCall[] = [];
    const liveGame = {
        notify(...args: [string, number?]) {
            const [message, durationMs] = args;
            calls.push({ message, durationMs, argumentCount: args.length });
            queue.push({ id: `notice-${queue.length + 1}`, message, duration: durationMs ?? 3000 });
            return null;
        },
        getGameState: () => ({ notificationMgr: { toArray: () => [...queue] } }),
    } as unknown as LiveGame;
    return { liveGame, calls };
}

/** The live-game half of a host, as `GameApp` and the story preview build it. */
function liveGameCallbacks(liveGame: LiveGame | null) {
    return createLiveGameUiCallbacks({
        requireLiveGame: () => {
            if (!liveGame) {
                throw new Error("“Post Notification” needs a running game.");
            }
            return liveGame;
        },
        getLiveGame: () => liveGame,
        choiceMenus: createChoiceMenus(),
        currentDialogNametagRef: { current: null },
        dialogClickTargets: createDialogClickTargets(),
    });
}

function hostAdapter(extra: Partial<BridgeOptions> = {}): UIHostAdapter {
    const options = {
        document: { surfaces: [], elements: {} },
        scope: { get: () => undefined, set: () => undefined },
        emit: () => undefined,
        activeSurfaceId: "surface",
        runtimeScopeId: "scope",
        widgetRuntimeStore: { get: () => undefined, set: () => undefined, subscribe: () => () => undefined },
        ...extra,
    } as unknown as BridgeOptions;
    return {
        host: "player",
        blueprintRuntime: { hostApi: createDevModeBlueprintHostApi(options) },
    } as unknown as UIHostAdapter;
}

/** Post, then write what `Get Notifications` reads into the local `listed`. */
function postThenListGraph(params: Record<string, unknown>): UIGraph {
    return {
        id: "post-notification",
        entries: { main: { start: { nodeId: "post", port: "in" } } },
        nodes: {
            post: { id: "post", type: BLUEPRINT_NODE_TYPE_GAME_POST_NOTIFICATION, params },
            read: { id: "read", type: BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS, params: {} },
            listed: { id: "listed", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "listed" } },
        },
        edges: [
            { from: { nodeId: "post", port: "next" }, to: { nodeId: "listed", port: "in" } },
            { from: { nodeId: "read", port: "notifications" }, to: { nodeId: "listed", port: "value" } },
        ],
    } as unknown as UIGraph;
}

async function run(graph: UIGraph, adapter: UIHostAdapter): Promise<Record<string, unknown>> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph,
        entry: { start: { nodeId: "post", port: "in" } },
        hostAdapter: adapter,
        blueprintLocals: locals,
    });
    return locals;
}

describe("Post Notification", () => {
    it("is an exec node with a message and an optional duration, outside function graphs", () => {
        registerCoreBlueprintNodes();
        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_GAME_POST_NOTIFICATION);

        expect(def?.pins.map(pin => [pin.id, pin.kind, pin.semantic, pin.valueType ?? null, pin.optional === true]))
            .toEqual([
                ["in", "input", "exec", null, false],
                ["next", "output", "exec", null, false],
                ["message", "input", "data", "string", false],
                ["duration", "input", "data", "float", true],
            ]);
        expect(def?.isPure).toBe(false);
        expect(def?.isLatent).toBe(false);
        expect(def?.graphKinds).toEqual(["event", "macro"]);
        expect(def?.category).toBe("Game");
    });

    it("posts into the stream Get Notifications reads, with the duration in milliseconds", async () => {
        registerCoreBlueprintNodes();
        const { liveGame, calls } = fakeLiveGame();
        const callbacks = liveGameCallbacks(liveGame);

        const locals = await run(
            postThenListGraph({ message: "Chapter unlocked", duration: 2.5 }),
            hostAdapter({
                onPostNotification: callbacks.onPostNotification,
                onGetNotifications: callbacks.onGetNotifications,
            }),
        );

        expect(calls).toEqual([{ message: "Chapter unlocked", durationMs: 2500, argumentCount: 2 }]);
        expect(locals.listed).toEqual([{ id: "notice-1", message: "Chapter unlocked" }]);
    });

    it("leaves the engine's default duration in force when none is given", async () => {
        registerCoreBlueprintNodes();
        const { liveGame, calls } = fakeLiveGame();
        const callbacks = liveGameCallbacks(liveGame);

        const locals = await run(
            postThenListGraph({ message: "Saved" }),
            hostAdapter({
                onPostNotification: callbacks.onPostNotification,
                onGetNotifications: callbacks.onGetNotifications,
            }),
        );

        // One argument, not an explicit `undefined` and not a copy of the default.
        expect(calls).toEqual([{ message: "Saved", durationMs: undefined, argumentCount: 1 }]);
        expect(locals.listed).toEqual([{ id: "notice-1", message: "Saved" }]);
    });

    it("lists every line posted, in order", async () => {
        registerCoreBlueprintNodes();
        const { liveGame } = fakeLiveGame();
        const callbacks = liveGameCallbacks(liveGame);
        const adapter = hostAdapter({
            onPostNotification: callbacks.onPostNotification,
            onGetNotifications: callbacks.onGetNotifications,
        });

        await run(postThenListGraph({ message: "First" }), adapter);
        const locals = await run(postThenListGraph({ message: "Second", duration: 1 }), adapter);

        expect(locals.listed).toEqual([
            { id: "notice-1", message: "First" },
            { id: "notice-2", message: "Second" },
        ]);
    });

    it("refuses on a host that runs no game, rather than dropping the line", async () => {
        registerCoreBlueprintNodes();

        await expect(run(postThenListGraph({ message: "Hello" }), hostAdapter()))
            .rejects.toThrow(/needs a running game/);
    });

    it("refuses between games, when the host has the channel but no game is running", async () => {
        registerCoreBlueprintNodes();
        const callbacks = liveGameCallbacks(null);

        await expect(run(
            postThenListGraph({ message: "Hello" }),
            hostAdapter({
                onPostNotification: callbacks.onPostNotification,
                onGetNotifications: callbacks.onGetNotifications,
            }),
        )).rejects.toThrow(/needs a running game/);
    });

    it("refuses an empty message and a duration that is not above zero", async () => {
        registerCoreBlueprintNodes();
        const { liveGame, calls } = fakeLiveGame();
        const callbacks = liveGameCallbacks(liveGame);
        const adapter = hostAdapter({
            onPostNotification: callbacks.onPostNotification,
            onGetNotifications: callbacks.onGetNotifications,
        });

        await expect(run(postThenListGraph({ message: "   " }), adapter)).rejects.toThrow(/is empty/);
        await expect(run(postThenListGraph({ message: "Hello", duration: 0 }), adapter))
            .rejects.toThrow(/greater than 0/);
        await expect(run(postThenListGraph({ message: "Hello", duration: "soon" }), adapter))
            .rejects.toThrow(/must be a number/);
        expect(calls).toEqual([]);
    });
});
