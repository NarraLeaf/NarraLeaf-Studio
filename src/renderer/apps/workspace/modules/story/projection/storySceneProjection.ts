import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryDocument,
    StoryExpr,
    StoryNodeActionPayload,
    StoryScene,
    StoryVariableRef,
} from "@shared/types/story";
import { formatStoryLiteral, layerActionTargetRef, resolveStoryLayerRef, storyVariableRefKey } from "@shared/types/story";
import { formatStorySecondsLabel } from "@shared/utils/storyTime";
import { getSceneName } from "../scene-editor/storySceneBlockUtils";

export type EditableStoryLineKind = "narration" | "dialogue" | "note";

export type StorySceneProjectionLine = {
    lineNumber: number;
    blockId: StoryBlockId;
    block: StoryBlock;
    depth: number;
    editable: boolean;
    editableKind?: EditableStoryLineKind;
    prefix: string;
};

export type StorySceneTextProjection = {
    text: string;
    lines: StorySceneProjectionLine[];
    lineToBlockId: Map<number, StoryBlockId>;
    blockToLineNumber: Map<StoryBlockId, number>;
};

export type StoryLineTextChange =
    | {
          ok: true;
          blockId: StoryBlockId;
          value: string;
      }
    | {
          ok: false;
          reason: "empty" | "multiple-lines" | "line-count" | "read-only" | "prefix";
          lineNumber?: number;
      };

export function buildStorySceneTextProjection(scene: StoryScene, document?: StoryDocument): StorySceneTextProjection {
    const lines: StorySceneProjectionLine[] = [];
    const textLines: string[] = [];

    const visit = (blockId: StoryBlockId, depth: number) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        const projected = projectBlockLine(block, depth, scene, document);
        const lineNumber = textLines.length + 1;
        textLines.push(projected.text);
        lines.push({
            lineNumber,
            blockId,
            block,
            depth,
            editable: projected.editable,
            editableKind: projected.editableKind,
            prefix: projected.prefix,
        });
        for (const childId of block.childrenIds) {
            visit(childId, depth + 1);
        }
    };

    for (const blockId of scene.rootBlockIds) {
        visit(blockId, 0);
    }

    const lineToBlockId = new Map<number, StoryBlockId>();
    const blockToLineNumber = new Map<StoryBlockId, number>();
    for (const line of lines) {
        lineToBlockId.set(line.lineNumber, line.blockId);
        blockToLineNumber.set(line.blockId, line.lineNumber);
    }

    return {
        text: textLines.join("\n"),
        lines,
        lineToBlockId,
        blockToLineNumber,
    };
}

export function getLineTextChange(
    projection: StorySceneTextProjection,
    previousText: string,
    nextText: string,
): StoryLineTextChange {
    const previousLines = splitEditorText(previousText);
    const nextLines = splitEditorText(nextText);
    if (previousLines.length !== nextLines.length) {
        return { ok: false, reason: "line-count" };
    }

    const changedLineNumbers: number[] = [];
    for (let index = 0; index < previousLines.length; index += 1) {
        if (previousLines[index] !== nextLines[index]) {
            changedLineNumbers.push(index + 1);
        }
    }

    if (changedLineNumbers.length === 0) {
        return { ok: false, reason: "empty" };
    }
    if (changedLineNumbers.length > 1) {
        return { ok: false, reason: "multiple-lines" };
    }

    const lineNumber = changedLineNumbers[0];
    const line = projection.lines[lineNumber - 1];
    if (!line || !line.editable) {
        return { ok: false, reason: "read-only", lineNumber };
    }
    const nextLine = nextLines[lineNumber - 1] ?? "";
    if (!nextLine.startsWith(line.prefix)) {
        return { ok: false, reason: "prefix", lineNumber };
    }

    return {
        ok: true,
        blockId: line.blockId,
        value: nextLine.slice(line.prefix.length),
    };
}

export function updateBlockTextValue(block: StoryBlock, value: string): StoryBlock["payload"] | null {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") {
            return {
                ...block.payload,
                text: { ...block.payload.text, value },
            };
        }
        if (block.payload.action === "dialogue") {
            return {
                ...block.payload,
                text: { ...block.payload.text, value },
            };
        }
    }
    if (block.kind === "note") {
        return {
            ...block.payload,
            text: { ...block.payload.text, value },
        };
    }
    return null;
}

function projectBlockLine(
    block: StoryBlock,
    depth: number,
    scene: StoryScene,
    document?: StoryDocument,
): { text: string; editable: boolean; editableKind?: EditableStoryLineKind; prefix: string } {
    const indent = "  ".repeat(depth);
    if (block.kind === "nodeAction") {
        return projectNodeActionLine(block.payload, indent);
    }
    if (block.kind === "action") {
        return { text: `${indent}${formatAction(block.payload, scene, document)}`, editable: false, prefix: "" };
    }
    if (block.kind === "control") {
        if (block.payload.control === "conditionBranch") {
            const label = block.payload.branch === "else" ? "else" : `${block.payload.branch} ${formatCondition(block.payload.condition, scene, document)}`;
            return { text: `${indent}/${label}`, editable: false, prefix: "" };
        }
        return { text: `${indent}/condition`, editable: false, prefix: "" };
    }
    if (block.kind === "jump") {
        return { text: `${indent}/jump ${getSceneName(document?.scenes, block.payload.targetSceneId)}`, editable: false, prefix: "" };
    }
    if (block.kind === "code") {
        const marker = block.payload.folded ? " folded" : "";
        return { text: `${indent}/code ${block.payload.language}${marker}`, editable: false, prefix: "" };
    }
    if (block.kind === "invalid") {
        // Verbatim: the line never parsed, so there is nothing to pretty-print from.
        return { text: `${indent}${block.payload.source}`, editable: false, prefix: "" };
    }
    const prefix = `${indent}// `;
    return {
        text: `${prefix}${block.payload.text.value}`,
        editable: true,
        editableKind: "note",
        prefix,
    };
}

function projectNodeActionLine(
    payload: StoryNodeActionPayload,
    indent: string,
): { text: string; editable: boolean; editableKind?: EditableStoryLineKind; prefix: string } {
    if (payload.action === "narration") {
        return {
            text: `${indent}${payload.text.value}`,
            editable: true,
            editableKind: "narration",
            prefix: indent,
        };
    }
    if (payload.action === "dialogue") {
        const prefix = `${indent}${payload.characterId || "Character"}: `;
        return {
            text: `${prefix}${payload.text.value}`,
            editable: true,
            editableKind: "dialogue",
            prefix,
        };
    }
    if (payload.action === "choice") {
        return {
            text: `${indent}/choice${payload.prompt ? ` ${payload.prompt.value}` : ""}`,
            editable: false,
            prefix: "",
        };
    }
    return {
        text: `${indent}- ${payload.text.value}`,
        editable: false,
        prefix: "",
    };
}

function formatAction(payload: StoryActionPayload, scene: StoryScene, document?: StoryDocument): string {
    if (payload.action === "setBackground") {
        return `/background ${payload.assetId ?? payload.color ?? ""}`.trimEnd();
    }
    if (payload.action === "character") {
        return `/character ${payload.operation}${payload.characterId ? ` ${payload.characterId}` : payload.objectName ? ` ${payload.objectName}` : ""}`;
    }
    if (payload.action === "audio") {
        return `/audio ${payload.operation}${payload.objectName ? ` ${payload.objectName}` : payload.assetId ? ` ${payload.assetId}` : ""}`;
    }
    if (payload.action === "setVariable") {
        return describeAssignment(payload, scene, document);
    }
    if (payload.action === "wait") {
        return payload.mode === "duration" ? `/wait ${formatStorySecondsLabel(payload.durationMs ?? 0)}` : "/wait click";
    }
    if (payload.action === "image") {
        return `/image ${payload.operation} ${payload.objectName}`.trimEnd();
    }
    if (payload.action === "displayable") {
        return `/displayable ${payload.operation} ${payload.target.name}`.trimEnd();
    }
    if (payload.action === "text") {
        return `/text ${payload.operation} ${payload.objectName}${payload.text ? ` ${payload.text}` : ""}`.trimEnd();
    }
    if (payload.action === "layer") {
        const name = payload.operation === "create"
            ? payload.objectName
            : resolveStoryLayerRef(scene, layerActionTargetRef(payload.target, payload.objectName)).name;
        return `/layer ${payload.operation} ${name}`.trimEnd();
    }
    if (payload.action === "video") {
        return `/video ${payload.operation} ${payload.objectName}`.trimEnd();
    }
    if (payload.action === "nvl") {
        return "/nvl";
    }
    if (payload.action === "blueprint") {
        return "/blueprint";
    }
    return `/effect ${payload.effect}`;
}

function formatCondition(condition: StoryConditionRef | undefined, scene: StoryScene, document?: StoryDocument): string {
    if (!condition) {
        return "<condition>";
    }
    if (condition.kind === "expression") {
        return condition.expression.source || "<expression>";
    }
    if (condition.kind === "blueprint") {
        return "<graph condition>";
    }
    return `${describeVariableRef(condition.target, scene, document)} ${condition.operator}${condition.value !== undefined ? ` ${String(condition.value)}` : ""}`;
}

/**
 * Render an assignment back as the command that would produce it - including the shorthand.
 *
 * `/inc gold` must not come back as `/set gold gold + (1)`. The author typed a shorthand; showing
 * them the desugared form would teach them their shorthand does not survive, and would make the row
 * grow every time they glanced at it. So the sugar shapes are recognized structurally (a binary
 * `+`/`-` whose left operand is the assignment target, a `!` of the target) and rendered back.
 *
 * Structural recognition rather than a stored "this was an /inc" flag, because the two must agree:
 * a `/set gold gold + 1` typed longhand *is* an increment and should read as one.
 */
function describeAssignment(
    payload: Extract<StoryActionPayload, { action: "setVariable" }>,
    scene: StoryScene,
    document?: StoryDocument,
): string {
    const name = describeVariableRef(payload.target, scene, document);
    const ast = payload.expression?.ast;
    if (!ast) {
        return `/set ${name} ${String(payload.value)}`;
    }

    const targetKey = storyVariableRefKey(payload.target);
    const readsTarget = (node: typeof ast): boolean => node.kind === "var" && storyVariableRefKey(node.target) === targetKey;

    if (ast.kind === "unary" && ast.op === "!" && readsTarget(ast.operand)) {
        return `/toggle ${name}`;
    }
    if (ast.kind === "binary" && (ast.op === "+" || ast.op === "-") && readsTarget(ast.left)) {
        const token = ast.op === "+" ? "inc" : "dec";
        // `by 1` is the default the command implies, so `/inc gold` reads better than `/inc gold 1`.
        const step = ast.right.kind === "literal" && ast.right.value === 1 ? "" : ` ${formatExpr(ast.right)}`;
        return `/${token} ${name}${step}`;
    }
    return `/set ${name} ${payload.expression?.source ?? formatExpr(ast)}`;
}

/**
 * Re-render a subtree as source. Only reached for the step of an `/inc`/`/dec`, where the stored
 * `source` describes the whole assignment and so cannot be sliced for just the operand.
 */
function formatExpr(expr: StoryExpr): string {
    switch (expr.kind) {
        case "literal":
            return formatStoryLiteral(expr.value);
        case "var":
            return expr.name;
        case "unary":
            return `${expr.op}${formatExpr(expr.operand)}`;
        case "binary":
            return `(${formatExpr(expr.left)} ${expr.op} ${formatExpr(expr.right)})`;
        case "ternary":
            return `(${formatExpr(expr.test)} ? ${formatExpr(expr.consequent)} : ${formatExpr(expr.alternate)})`;
        case "call":
            return `${expr.fn}(${expr.args.map(formatExpr).join(", ")})`;
        case "invalid":
            return expr.source;
    }
}

/** Compact, user-safe label for a variable reference (never exposes internal ids). */
function describeVariableRef(ref: StoryVariableRef, scene: StoryScene, document?: StoryDocument): string {
    if (ref.scope === "scene") {
        return scene.sceneVariables?.[ref.variableId]?.name ?? "variable";
    }
    if (ref.scope === "saved") {
        return document?.savedVariables?.[ref.variableId]?.name ?? "variable";
    }
    return "persistent";
}

function splitEditorText(value: string): string[] {
    return value.split(/\r?\n/);
}
