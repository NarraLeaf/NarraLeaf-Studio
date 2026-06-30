import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryNodeActionPayload,
    StoryScene,
} from "@shared/types/story";

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

export function buildStorySceneTextProjection(scene: StoryScene): StorySceneTextProjection {
    const lines: StorySceneProjectionLine[] = [];
    const textLines: string[] = [];

    const visit = (blockId: StoryBlockId, depth: number) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        const projected = projectBlockLine(block, depth);
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
): { text: string; editable: boolean; editableKind?: EditableStoryLineKind; prefix: string } {
    const indent = "  ".repeat(depth);
    if (block.kind === "nodeAction") {
        return projectNodeActionLine(block.payload, indent);
    }
    if (block.kind === "action") {
        return { text: `${indent}${formatAction(block.payload)}`, editable: false, prefix: "" };
    }
    if (block.kind === "control") {
        if (block.payload.control === "conditionBranch") {
            const label = block.payload.branch === "else" ? "else" : `${block.payload.branch} ${formatCondition(block.payload.condition)}`;
            return { text: `${indent}/${label}`, editable: false, prefix: "" };
        }
        return { text: `${indent}/condition`, editable: false, prefix: "" };
    }
    if (block.kind === "jump") {
        return { text: `${indent}/jump ${block.payload.targetSceneId}`, editable: false, prefix: "" };
    }
    if (block.kind === "code") {
        const marker = block.payload.folded ? " folded" : "";
        return { text: `${indent}/code ${block.payload.language}${marker}`, editable: false, prefix: "" };
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

function formatAction(payload: StoryActionPayload): string {
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
        return `/set ${payload.target.key} ${String(payload.value)}`;
    }
    if (payload.action === "wait") {
        return payload.mode === "duration" ? `/wait ${payload.durationMs ?? 0}ms` : "/wait click";
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
        return `/layer ${payload.operation} ${payload.objectName}`.trimEnd();
    }
    if (payload.action === "video") {
        return `/video ${payload.operation} ${payload.objectName}`.trimEnd();
    }
    if (payload.action === "nvl") {
        return "/nvl";
    }
    return `/effect ${payload.effect}`;
}

function formatCondition(condition: StoryConditionRef | undefined): string {
    if (!condition) {
        return "<condition>";
    }
    if (condition.kind === "expression") {
        return condition.source || "<expression>";
    }
    return `${condition.target.key} ${condition.operator}${condition.value !== undefined ? ` ${String(condition.value)}` : ""}`;
}

function splitEditorText(value: string): string[] {
    return value.split(/\r?\n/);
}
