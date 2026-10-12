/**
 * Video widget nodes: play, pause, stop and seek a video, and read where it has got to.
 *
 * Each comes twice, as the other widget families do: once for the video's own blueprint (category
 * Video, acting on the video the blueprint belongs to) and once for any graph on the page (category
 * Element, acting on the video wired into its Video pin). Both titles are the same, so the palette
 * search finds one name whichever graph it is searched from.
 *
 * The commands do not wait for playback. Play is asked of the widget and the graph carries on: a clip
 * still loading starts when it arrives, and a play the browser refuses leaves the video where it was
 * and says so in the game's log rather than failing the graph. A graph that has to wait for the clip
 * to finish listens for Playback Ended on the video's own blueprint.
 *
 * Comments in English per project convention.
 */

import { isUIElementRefInScope } from "@shared/types/ui-editor/componentInstanceKey";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_DURATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_TIME,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_ENDED,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PAUSE,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_SEEK,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_STOP,
    BLUEPRINT_NODE_TYPE_VIDEO_GET_DURATION,
    BLUEPRINT_NODE_TYPE_VIDEO_GET_TIME,
    BLUEPRINT_NODE_TYPE_VIDEO_IS_ENDED,
    BLUEPRINT_NODE_TYPE_VIDEO_IS_PLAYING,
    BLUEPRINT_NODE_TYPE_VIDEO_PAUSE,
    BLUEPRINT_NODE_TYPE_VIDEO_PLAY,
    BLUEPRINT_NODE_TYPE_VIDEO_SEEK,
    BLUEPRINT_NODE_TYPE_VIDEO_STOP,
} from "@shared/types/blueprint/graph";
import { blueprintElementValueType } from "@shared/types/blueprint/valueTypes";
import { UI_VIDEO_ELEMENT_TYPE } from "@shared/types/ui-editor/video";
import { translate } from "@/lib/i18n";
import type { BlueprintVideoCommand } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import { widgetKindName } from "../widgetKindName";
import { WIDGET_OWN_GRAPH_OWNER_KINDS, type BlueprintNodeDef, type BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveNodeInput } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";
import { addressWidgetFromExecution } from "./widgetTarget";

type Target = "self" | "element";
type ExecuteCtx = Parameters<BlueprintNodeDef["execute"]>[0];

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;

/** The element input of the Element-category twins; also what the palette lists them under a video by. */
export const VIDEO_ELEMENT_PIN_ID = "video";

const VIDEO_MAGIC_TARGET: NonNullable<BlueprintNodeDef["magicElementTarget"]> = {
    inputPinId: VIDEO_ELEMENT_PIN_ID,
    elementTypes: [UI_VIDEO_ELEMENT_TYPE],
};
const VIDEO_SCOPE: BlueprintNodeDef["scope"] = {
    ownerKinds: [...WIDGET_OWN_GRAPH_OWNER_KINDS],
    widgetElementTypes: [UI_VIDEO_ELEMENT_TYPE],
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const videoIn: BlueprintNodePinDef = {
    id: VIDEO_ELEMENT_PIN_ID,
    kind: "input",
    semantic: "data",
    valueType: blueprintElementValueType(UI_VIDEO_ELEMENT_TYPE),
    label: "Video",
};
/** Where Seek moves the play head: seconds from the start of the clip, as Seek Sound reads its time. */
const seekTimeIn: BlueprintNodePinDef = {
    id: "time",
    kind: "input",
    semantic: "data",
    valueType: "float",
    label: "Time (s)",
    allowInlineLiteral: true,
};
const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

function readNode(input: {
    type: string;
    displayName: string;
    description: BlueprintNodeDef["description"];
    keywords: string[];
    output: BlueprintNodePinDef;
    target: Target;
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        description: input.description,
        category: elementTarget ? "Element" : "Video",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: elementTarget ? [videoIn, input.output] : [input.output],
        magicElementTarget: elementTarget ? VIDEO_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : VIDEO_SCOPE,
        // Answered by `resolveVideoNodeOutput` in `graphParamResolvers.ts`, from the drawn element.
        execute: () => ({}),
    };
}

function commandNode(input: {
    type: string;
    displayName: string;
    description: BlueprintNodeDef["description"];
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    target: Target;
    command: (ctx: ExecuteCtx) => BlueprintVideoCommand;
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    const extraPins = input.pins ?? [];
    return {
        type: input.type,
        displayName: input.displayName,
        description: input.description,
        category: elementTarget ? "Element" : "Video",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: elementTarget ? [execIn, execNext, videoIn, ...extraPins] : [execIn, execNext, ...extraPins],
        magicElementTarget: elementTarget ? VIDEO_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : VIDEO_SCOPE,
        execute: async ctx => {
            const elementId = resolveVideoAddress(ctx, input.target);
            await requireHostApi(ctx).widget.controlVideo(elementId, input.command(ctx));
            return { nextPort: "next" };
        },
    };
}

/**
 * The address of the video a node acts on: the one wired into its Video pin, or - in the video's own
 * blueprint - the video the blueprint belongs to.
 */
function resolveVideoAddress(ctx: ExecuteCtx, target: Target): string {
    if (target === "self") {
        const elementId = ctx.executionOwner?.elementId;
        if (!elementId) {
            throw new BlueprintGraphExecutionError(translate("blueprint.runtimeError.noElement"), ctx.node.id);
        }
        return addressWidgetFromExecution(ctx, elementId);
    }
    const ref = normalizeBlueprintElementRefValue(resolveNodeInput(ctx, VIDEO_ELEMENT_PIN_ID));
    if (!ref) {
        throw new BlueprintGraphExecutionError(translate("blueprint.runtimeError.noElement"), ctx.node.id);
    }
    if (ref.elementType !== UI_VIDEO_ELEMENT_TYPE) {
        throw new BlueprintGraphExecutionError(
            translate("blueprint.runtimeError.elementWrongKind", { kind: widgetKindName(UI_VIDEO_ELEMENT_TYPE) }),
            ctx.node.id,
        );
    }
    if (!isUIElementRefInScope(ref.surfaceId, ctx.executionOwner)) {
        throw new BlueprintGraphExecutionError(translate("blueprint.runtimeError.elementOutOfScope"), ctx.node.id);
    }
    return addressWidgetFromExecution(ctx, ref.elementId);
}

function readSeekSeconds(ctx: ExecuteCtx): number {
    const raw = resolveNodeInput(ctx, "time");
    const seconds = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(seconds) ? seconds : 0;
}

function videoNodes(target: Target): BlueprintNodeDef[] {
    const element = target === "element";
    return [
        commandNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY : BLUEPRINT_NODE_TYPE_VIDEO_PLAY,
            displayName: "Play Video",
            description: "blueprint.nodeDescription.playVideo",
            keywords: ["video", "movie", "clip", "play", "start", "resume", "playback"],
            target,
            command: () => ({ kind: "play" }),
        }),
        commandNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PAUSE : BLUEPRINT_NODE_TYPE_VIDEO_PAUSE,
            displayName: "Pause Video",
            description: "blueprint.nodeDescription.pauseVideo",
            keywords: ["video", "movie", "clip", "pause", "hold", "playback"],
            target,
            command: () => ({ kind: "pause" }),
        }),
        commandNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_STOP : BLUEPRINT_NODE_TYPE_VIDEO_STOP,
            displayName: "Stop Video",
            description: "blueprint.nodeDescription.stopVideo",
            keywords: ["video", "movie", "clip", "stop", "rewind", "reset", "playback"],
            target,
            command: () => ({ kind: "stop" }),
        }),
        commandNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_SEEK : BLUEPRINT_NODE_TYPE_VIDEO_SEEK,
            displayName: "Seek Video",
            description: "blueprint.nodeDescription.seekVideo",
            keywords: ["video", "movie", "clip", "seek", "position", "time", "jump", "skip", "playback"],
            pins: [seekTimeIn],
            target,
            command: ctx => ({ kind: "seek", seconds: readSeekSeconds(ctx) }),
        }),
        readNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_TIME : BLUEPRINT_NODE_TYPE_VIDEO_GET_TIME,
            displayName: "Get Video Time",
            description: "blueprint.nodeDescription.getVideoTime",
            keywords: ["video", "movie", "clip", "time", "position", "current", "progress", "playback"],
            output: out("time", "Time (s)", "float"),
            target,
        }),
        readNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_DURATION : BLUEPRINT_NODE_TYPE_VIDEO_GET_DURATION,
            displayName: "Get Video Duration",
            description: "blueprint.nodeDescription.getVideoDuration",
            keywords: ["video", "movie", "clip", "duration", "length", "time", "playback"],
            output: out("duration", "Duration (s)", "float"),
            target,
        }),
        readNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING : BLUEPRINT_NODE_TYPE_VIDEO_IS_PLAYING,
            displayName: "Is Video Playing",
            description: "blueprint.nodeDescription.isVideoPlaying",
            keywords: ["video", "movie", "clip", "playing", "state", "check", "playback"],
            output: out("isPlaying", "Is Playing", "boolean"),
            target,
        }),
        readNode({
            type: element ? BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_ENDED : BLUEPRINT_NODE_TYPE_VIDEO_IS_ENDED,
            displayName: "Is Video Ended",
            description: "blueprint.nodeDescription.isVideoEnded",
            keywords: ["video", "movie", "clip", "ended", "finished", "done", "state", "check", "playback"],
            output: out("isEnded", "Is Ended", "boolean"),
            target,
        }),
    ];
}

export const videoBlueprintNodes: BlueprintNodeDef[] = [...videoNodes("self"), ...videoNodes("element")];
