/**
 * A loop the step budget stops reaches the author, and says which loop it was.
 *
 * The stop was reported before, as "Behavior graph execution exceeded 512 steps": no event, no node,
 * and - for the global blueprint, which belongs to no surface - no place at all. An author with a
 * dozen graphs had nothing to go on. What is pinned here is the whole way out: the real dispatcher
 * running the global blueprint, the two reports a failure makes (the executor's and the
 * dispatcher's), and the Dev Mode window's own mapping, which has to turn them into one issue naming
 * the event head and the node, in the author's language.
 */

import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import {
    appendRuntimeIssue,
    blueprintDebugEventIssue,
    locateRuntimeIssue,
    type LocatedRuntimeIssue,
    type StoryRowBundle,
} from "@/apps/dev-mode/components/runtimeIssueModel";
import { dispatchGlobalBlueprintEvent } from "./BlueprintDispatcher";
import { DebugBridge } from "./DebugBridge";

const GLOBAL_ID = "bp-global";

/** On Game Ready, into two Delays of zero that hand the run back and forth forever. */
const globalBlueprint = {
    id: GLOBAL_ID,
    name: GLOBAL_ID,
    owner: { kind: "globalMain" },
    members: { variables: {}, fields: {}, functions: {} },
    bindings: {},
    graphs: {
        events: {
            poll: {
                id: "poll",
                graph: {
                    nodes: {
                        head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY },
                        first: { id: "first", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 } },
                        second: { id: "second", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 } },
                    },
                    edges: [
                        { from: { nodeId: "head", port: "then" }, to: { nodeId: "first", port: "in" } },
                        { from: { nodeId: "first", port: "completed" }, to: { nodeId: "second", port: "in" } },
                        { from: { nodeId: "second", port: "completed" }, to: { nodeId: "first", port: "in" } },
                    ],
                },
            },
        },
        functions: {},
    },
} as unknown as Blueprint;

const issueBundle = { ui: { persistentVariables: {}, savedVariables: {} } } as unknown as StoryRowBundle;

async function runStoppedLoop(): Promise<BlueprintDebugEvent[]> {
    const debug = new DebugBridge();
    const state = new Map<string, unknown>();
    await dispatchGlobalBlueprintEvent({
        blueprintDocument: blueprintDocumentOf([globalBlueprint]),
        persistentVariables: {},
        eventName: "gameReady",
        hostAdapter: {} as UIHostAdapter,
        debug,
        getSurfaceState: key => state.get(key),
        setSurfaceState: (key, value) => state.set(key, value),
        maxSteps: 20,
    });
    return debug.snapshot();
}

function issuesIn(language: "en" | "zh", events: readonly BlueprintDebugEvent[]): LocatedRuntimeIssue[] {
    const { t } = createTranslator(language);
    let issues: readonly LocatedRuntimeIssue[] = [];
    events.forEach((event, index) => {
        const issue = blueprintDebugEventIssue(event, t, { globalBlueprintId: GLOBAL_ID });
        if (issue) {
            issues = appendRuntimeIssue(issues, locateRuntimeIssue(issueBundle, issue, `issue-${index}`));
        }
    });
    return [...issues];
}

describe("a loop stopped for never waiting", () => {
    it("is reported by both the executor and the dispatcher, naming the head and the node", async () => {
        const errors = (await runStoppedLoop()).filter(event => event.type === "execution.error");

        expect(errors).toHaveLength(2);
        for (const error of errors) {
            expect(error).toMatchObject({
                blueprintId: GLOBAL_ID,
                stepLimit: { steps: 20, nodeName: "Delay", headName: "On Game Ready" },
            });
        }
    });

    it("becomes one issue in the Dev Mode list, saying it was the global blueprint", async () => {
        const events = await runStoppedLoop();

        const english = issuesIn("en", events);
        expect(english).toHaveLength(1);
        expect(english[0]).toMatchObject({
            level: "error",
            origin: "interface",
            message: "\"On Game Ready\" in the global blueprint stopped at \"Delay\" after 20 steps without a wait.",
        });

        const chinese = issuesIn("zh", events);
        expect(chinese).toHaveLength(1);
        expect(chinese[0]?.message).toBe("全局蓝图的“游戏就绪时”连续执行 20 步未等待，已在“延迟”处中止");
    });
});
