import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryDocument,
    StoryNodeActionPayload,
    StoryScene,
    StoryVariableRef,
} from "@shared/types/story";
import {
    formatStoryLiteral,
    layerActionTargetRef,
    resolveStoryLayerRef,
    savedVariableDefs,
    sceneVariableDefs,
    storyPersistentDefs,
    storyVariableRefKey,
} from "@shared/types/story";
import { formatStoryExpr } from "@shared/utils/storyExpressionParser";
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

/**
 * Display names for project-level variables the story document does not declare, keyed by
 * {@link storyVariableRefKey}.
 *
 * Both `saved` and `persistent` are project-level: a variable may live only in the project registry,
 * with no row in this document or any other. Without this lookup such a reference renders as the
 * literal word "variable" - the fallback meant for a ref whose declaration was DELETED - so a
 * perfectly valid line reads to the author like a broken one.
 *
 * Keyed by the ref key rather than by a bare id because the two scopes address entries differently
 * (`saved` by entry id, `persistent` by storage key) and one map with two key spaces in it is a map
 * that will one day answer the wrong scope's question. Optional because the read-only projections
 * with no project services to read it from are still allowed to ask for a line of text.
 */
export type ProjectVariableNames = ReadonlyMap<string, string>;

export function buildStorySceneTextProjection(
    scene: StoryScene,
    document?: StoryDocument,
    variableNames?: ProjectVariableNames,
): StorySceneTextProjection {
    const lines: StorySceneProjectionLine[] = [];
    const textLines: string[] = [];

    const visit = (blockId: StoryBlockId, depth: number) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        const projected = projectBlockLine(block, depth, scene, document, variableNames);
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
    variableNames?: ProjectVariableNames,
): { text: string; editable: boolean; editableKind?: EditableStoryLineKind; prefix: string } {
    const indent = "  ".repeat(depth);
    if (block.kind === "nodeAction") {
        return projectNodeActionLine(block.payload, indent);
    }
    if (block.kind === "action") {
        return { text: `${indent}${formatAction(block.payload, scene, document, variableNames)}`, editable: false, prefix: "" };
    }
    if (block.kind === "control") {
        if (block.payload.control === "conditionBranch") {
            const label = block.payload.branch === "else" ? "else" : `${block.payload.branch} ${formatCondition(block.payload.condition, scene, document, variableNames)}`;
            return { text: `${indent}/${label}`, editable: false, prefix: "" };
        }
        if (block.payload.control === "label") {
            return { text: `${indent}/label ${block.payload.name}`.trimEnd(), editable: false, prefix: "" };
        }
        if (block.payload.control === "goto") {
            return { text: `${indent}/goto ${block.payload.targetLabel}`.trimEnd(), editable: false, prefix: "" };
        }
        if (block.payload.control === "break") {
            return { text: `${indent}/break`, editable: false, prefix: "" };
        }
        if (block.payload.control === "cut") {
            // The id, because this projection is pure and holds no variant table - the same standing-in
            // an asset id does on a `/background` line here.
            return { text: `${indent}/cut ${block.payload.appTagId}`.trimEnd(), editable: false, prefix: "" };
        }
        // Both loop forms render back as the command that produces them. The conditional one renders
        // as `/until`, not as `/repeat until="…"`: same block, but the greedy positional needs no
        // quotes, so this is both shorter and the spelling an author would actually type.
        if (block.payload.control === "repeat") {
            return block.payload.until
                ? { text: `${indent}/until ${formatCondition(block.payload.until, scene, document, variableNames)}`, editable: false, prefix: "" }
                : { text: `${indent}/repeat ${block.payload.times ?? 1}`, editable: false, prefix: "" };
        }
        return { text: `${indent}/condition`, editable: false, prefix: "" };
    }
    if (block.kind === "jump") {
        return { text: `${indent}/jump ${getSceneName(document?.scenes, block.payload.targetSceneId)}`, editable: false, prefix: "" };
    }
    if (block.kind === "invalid") {
        // Verbatim: the line never parsed, so there is nothing to pretty-print from.
        return { text: `${indent}${block.payload.source}`, editable: false, prefix: "" };
    }
    if (block.kind === "declaration") {
        // Render back as the command that declares it: `/local Gold 100`.
        const token = block.payload.scope === "scene" ? "local" : block.payload.scope === "saved" ? "var" : "persis";
        const suffix = block.payload.defaultValue !== undefined ? ` ${formatStoryLiteral(block.payload.defaultValue)}` : "";
        return { text: `${indent}/${token} ${block.payload.name}${suffix}`, editable: false, prefix: "" };
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

function formatAction(
    payload: StoryActionPayload,
    scene: StoryScene,
    document?: StoryDocument,
    variableNames?: ProjectVariableNames,
): string {
    if (payload.action === "setBackground") {
        return `/background ${payload.assetId ?? payload.color ?? ""}`.trimEnd();
    }
    if (payload.action === "character") {
        const subject = payload.characterId ? ` ${payload.characterId}` : payload.objectName ? ` ${payload.objectName}` : "";
        // The new label is the whole of a rename, so it rides the projected line like a text's content.
        // A puppet's requested state name is the same case: the row says nothing without it.
        const suffix = payload.operation === "setName" && payload.displayName
            ? ` ${payload.displayName}`
            : payload.puppetName ? ` ${payload.puppetName}`
                // A parameter row projects every pair: this text is the searchable body of the row, so
                // unlike the one-line summary it must not drop any of them.
                : Object.entries(payload.params ?? {}).map(([id, value]) => ` ${id}=${value}`).join("");
        return `/character ${payload.operation}${subject}${suffix}`;
    }
    if (payload.action === "audio") {
        return `/audio ${payload.operation}${payload.objectName ? ` ${payload.objectName}` : payload.assetId ? ` ${payload.assetId}` : ""}`;
    }
    if (payload.action === "setVariable") {
        return describeAssignment(payload, scene, document, variableNames);
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
    if (payload.action === "vfx") {
        return `/vfx ${payload.operation} ${payload.objectName}`.trimEnd();
    }
    if (payload.action === "nvl") {
        return "/nvl";
    }
    if (payload.action === "blueprint") {
        return "/blueprint";
    }
    if (payload.action === "camera") {
        const amount = payload.operation === "zoom" ? payload.zoom
            : payload.operation === "rotate" ? payload.rotation
                : payload.operation === "darken" ? payload.darkness
                    : undefined;
        return `/camera ${payload.operation}${amount === undefined ? "" : ` ${amount}`}`;
    }
    if (payload.action === "plugin") {
        // The action id, not the plugin's label: this projection is the exported script, which has to
        // round-trip through `#data` and be readable by whoever installs the plugin next - and the id
        // is the only half of the pair the document actually holds.
        return `/${payload.actionId}`;
    }
    return `/effect ${payload.effect}`;
}

/**
 * One-line rendering of a branch condition, as the text projection shows it.
 *
 * Exported because the scene-flow map labels its branch edges with the same string: two surfaces
 * describing the same `if` must not word it two ways, and the alternative (a second formatter next
 * to the graph) drifts the moment a condition kind is added.
 */
export function formatStoryConditionSummary(
    condition: StoryConditionRef | undefined,
    scene: StoryScene,
    document?: StoryDocument,
    variableNames?: ProjectVariableNames,
): string {
    return formatCondition(condition, scene, document, variableNames);
}

function formatCondition(
    condition: StoryConditionRef | undefined,
    scene: StoryScene,
    document?: StoryDocument,
    variableNames?: ProjectVariableNames,
): string {
    if (!condition) {
        return "<condition>";
    }
    if (condition.kind === "expression") {
        return condition.expression.source || "<expression>";
    }
    if (condition.kind === "blueprint") {
        return "<graph condition>";
    }
    return `${describeVariableRef(condition.target, scene, document, variableNames)} ${condition.operator}${condition.value !== undefined ? ` ${String(condition.value)}` : ""}`;
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
    variableNames?: ProjectVariableNames,
): string {
    const name = describeVariableRef(payload.target, scene, document, variableNames);
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
 *
 * The printer itself lives beside the parser (`formatStoryExpr`), because the only property that
 * makes it correct - that what it prints, the lexer reads back as the same tree - is a property of
 * the two together, and it is tested where both are.
 */
const formatExpr = formatStoryExpr;

/** Compact, user-safe label for a variable reference (never exposes internal ids). */
function describeVariableRef(
    ref: StoryVariableRef,
    scene: StoryScene,
    document?: StoryDocument,
    variableNames?: ProjectVariableNames,
): string {
    if (ref.scope === "scene") {
        return sceneVariableDefs(scene)[ref.variableId]?.name ?? "variable";
    }
    // Document row first, then the project registry - the same two surfaces, in the same order, the
    // command line and the compiler resolve a project-scoped name through.
    if (ref.scope === "saved") {
        return (document ? savedVariableDefs(document) : {})[ref.variableId]?.name
            ?? variableNames?.get(storyVariableRefKey(ref))
            ?? "variable";
    }
    // A persistent ref carries the STORAGE key, while the row table is keyed by block id, so the rows
    // are searched by the field the ref actually holds.
    const row = document
        ? Object.values(storyPersistentDefs(document)).find(def => def.storageKey === ref.variableId)
        : undefined;
    return row?.name ?? variableNames?.get(storyVariableRefKey(ref)) ?? "persistent";
}

function splitEditorText(value: string): string[] {
    return value.split(/\r?\n/);
}
