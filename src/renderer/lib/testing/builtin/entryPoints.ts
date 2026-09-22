import { startStoryNodeKey, type StoryEntryPointScan, type UndecidableStoryEntry } from "@shared/story/storyReachability";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import { resolveBlueprintNodeTitle } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { translate } from "@/lib/i18n";
import {
    scanProjectEntryPoints,
    type StartStoryTargetGap,
    type StartStoryTargetPin,
    type StartStoryTargetProject,
} from "@/lib/workspace/services/references/startStoryTargets";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchJumpTarget";
import { Services } from "@/lib/workspace/services/services";
// Type-only, for the reason `reachableEndings` states: the instances come off the service registry.
import type { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import type { TestRunContext, TestText } from "../types";
import type { BuiltInTestHost } from "./index";

/**
 * Where play begins, as the two story integrity tests read it - and, when it cannot be read, which
 * `Start Game` node is the reason.
 *
 * Both tests take the answer the project check takes (`scanProjectEntryPoints`), so a scene the
 * report calls orphaned is never one either test walks into. What this adds is the naming: a test
 * that has to decline says which node it could not read and where that node's value comes from, as
 * a finding the author can click through to.
 */

/** Everything the reading follows a value through, off the workspace's services. */
export async function readEntryPointProject(
    services: ReturnType<BuiltInTestHost["services"]>,
    stories: readonly { id: string; name: string; document: StoryDocument }[],
    blueprintDocument: BlueprintDocument | null,
): Promise<StartStoryTargetProject> {
    let uiDocument: StartStoryTargetProject["uiDocument"] = null;
    try {
        uiDocument = services.get<UIDocumentService>(Services.UIDocument).getDocument();
    } catch (error) {
        // Without the interface every wired target reads as unreadable, which declines rather than
        // guesses - see `StartStoryTargetGap`'s `interfaceUnread`.
        console.warn("[entry points] interface document unavailable", error);
    }
    let variableRegistry: StartStoryTargetProject["variableRegistry"] = [];
    try {
        variableRegistry = services.get<VariableRegistryService>(Services.VariableRegistry).listEntries();
    } catch (error) {
        console.warn("[entry points] variable registry unavailable", error);
    }
    let pluginStores: StartStoryTargetProject["pluginStores"] = null;
    try {
        pluginStores = await services.get<ServiceAssetsService>(Services.ServiceAssets).readPluginStores();
    } catch (error) {
        console.warn("[entry points] plugin stores unavailable", error);
    }
    return { stories, blueprintDocument, uiDocument, variableRegistry, pluginStores };
}

/**
 * The entry points, and - when any `Start Game` cannot be read - one finding per such node, naming
 * where its value comes from. `blocked` carries what the test's skip summary names.
 */
export function scanEntryPointsAndReport(
    ctx: Pick<TestRunContext, "report">,
    project: StartStoryTargetProject,
): { scan: StoryEntryPointScan; blocked: { blueprint: string } | null } {
    const { scan, gaps } = scanProjectEntryPoints(project);
    for (const entry of scan.undecidable) {
        const gap = gaps.get(startStoryNodeKey(entry)) ?? { pin: "sceneId" as const, gap: { kind: "unindexed" as const } };
        const target = gapTarget(entry, gap.gap, project.blueprintDocument);
        ctx.report({
            // Not a defect in the project: a scene picked at run time is a shape a game may have.
            // The finding is here to say which node stopped the test, not to ask for a change.
            severity: "info",
            message: gapMessage(entry, gap.pin, gap.gap),
            ...(target ? { target } : {}),
        });
    }
    const first = scan.undecidable[0];
    return { scan, blocked: first ? { blueprint: first.blueprintName ?? "" } : null };
}

/** The sentence for one unreadable node. Node titles are drawn the way the canvas draws their card. */
function gapMessage(entry: UndecidableStoryEntry, pin: StartStoryTargetPin, gap: StartStoryTargetGap): TestText {
    const params: Record<string, string> = {
        blueprint: entry.blueprintName ?? "",
        target: translate(pin === "storyId" ? "test.entryPoint.target.story" : "test.entryPoint.target.scene"),
    };
    switch (gap.kind) {
        case "assembled":
            return { key: "test.entryPoint.assembled", params: { ...params, origin: originText(gap.origin) } };
        case "unreadNode":
            return { key: "test.entryPoint.unreadNode", params: { ...params, origin: nodeTitle(gap.site.nodeTitle) } };
        case "unreadPluginData":
            return {
                key: "test.entryPoint.unreadPluginData",
                params: { ...params, origin: nodeTitle(gap.site.nodeTitle), plugin: gap.pluginId },
            };
        case "engineRows":
            return { key: "test.entryPoint.engineRows", params: { ...params, list: gap.elementName } };
        case "undeclaredVariable":
            return { key: "test.entryPoint.undeclaredVariable", params };
        case "unindexed":
        case "interfaceUnread":
            return { key: "test.entryPoint.unreadable", params };
    }
}

function originText(origin: Extract<StartStoryTargetGap, { kind: "assembled" }>["origin"]): string {
    switch (origin.kind) {
        case "node":
            return nodeTitle(origin.nodeTitle);
        case "storyRow":
            return `${origin.storyName} ▸ ${origin.sceneName}`;
        case "listSource":
            return origin.elementName;
        case "script":
            return origin.blueprintName;
    }
}

function nodeTitle(title: string): string {
    return resolveBlueprintNodeTitle(title, translate);
}

/**
 * Where clicking the finding goes: the node that decides the value when there is one - the one that
 * assembles it, or the one whose data is not read - and the `Start Game` itself otherwise.
 */
function gapTarget(
    entry: UndecidableStoryEntry,
    gap: StartStoryTargetGap,
    document: BlueprintDocument | null | undefined,
): SearchJumpTarget | undefined {
    const site = gap.kind === "assembled" && gap.origin.kind === "node"
        ? gap.origin
        : gap.kind === "unreadNode" || gap.kind === "unreadPluginData"
            ? gap.site
            : null;
    if (site) {
        return blueprintNodeTarget(site.blueprintId, site.ownerKey, site.graphKind, site.graphId, site.nodeId);
    }
    if (gap.kind === "assembled" && gap.origin.kind === "storyRow") {
        const origin = gap.origin;
        return {
            kind: "storyBlock",
            storyId: origin.storyId,
            sceneId: origin.sceneId,
            blockId: origin.blockId,
            storyName: origin.storyName,
            sceneName: origin.sceneName,
        };
    }
    const ownerKey = Object.entries(document?.ownerRecords ?? {}).find(([, record]) => record.blueprintId === entry.blueprintId)?.[0];
    return ownerKey ? blueprintNodeTarget(entry.blueprintId, ownerKey, entry.graphKind, entry.graphId, entry.nodeId) : undefined;
}

function blueprintNodeTarget(
    blueprintId: string,
    ownerKey: string,
    graphKind: "event" | "function" | "macro",
    graphId: string,
    nodeId: string,
): SearchJumpTarget {
    return {
        kind: "blueprint",
        blueprintId,
        ownerKey,
        focusNodeId: nodeId,
        ...(graphKind === "event" ? { focusEventId: graphId } : {}),
        ...(graphKind === "function" ? { focusFunctionId: graphId } : {}),
    };
}
