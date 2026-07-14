import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject, MouseEvent } from "react";
import { ChevronDown, ChevronRight, GripVertical, Hash, Image, Plus } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryDocument, StoryRichRun, StoryScene } from "@shared/types/story";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { resolveStoryMotionPreviewTarget } from "../../story-motion/storyMotionPreviewTarget";
import type { Character } from "@/lib/workspace/services/character/Character";
import {
    ACTION_COMMAND_CATEGORIES,
    ACTION_COMMANDS,
    actionCommandMatchesQuery,
    getActionCommandCategory,
    localizeActionCommand,
    translateActionCommandCategoryLabel,
    type ActionCommandCategory,
    type ActionCommandCategoryId,
    type PaletteActionCommand,
} from "./storyActionCommands";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { ActionInspector } from "./StorySceneActionInspector";
import { RichTextInput, type ActiveMarks, type InterpolationClickInfo, type PauseClickInfo, type RichTextInputHandle } from "./RichTextInput";
import { RichTextToolbar } from "./RichTextToolbar";
import { InterpolationPopover } from "./InterpolationPopover";
import { collectStoryVariableOptions, resolveInterpolationName, type PersistentVariableOption } from "./storyInterpolation";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { RichTextView } from "./RichTextView";
import { PausePopover } from "./PausePopover";
import { segmentToRuns } from "./richText";
import { useStoryEditorTextStyle } from "./storyEditorTextStyle";
import type { EditorMode, VisibleStoryRow } from "./storySceneEditorTypes";
import {
    canAcceptChildren,
    describeBlock,
    getBlockBadgeInfo,
    getCharacterName,
    getContainerHeaderInfo,
    getEmptyTextPlaceholder,
    getTextSegment,
    isContainerBlock,
    type StoryContainerHeaderInfo,
} from "./storySceneBlockUtils";
import { ConditionPopover } from "./ConditionPopover";

export function StoryBlockRow(props: {
    row: VisibleStoryRow;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    selected: boolean;
    active: boolean;
    collapsed: boolean;
    editing: boolean;
    /** Where the caret lands when this row opens for editing (arrow-navigation into it). */
    editInitialCaret?: "start" | "end";
    textInputRef: RefObject<RichTextInputHandle | null>;
    inspectorOpen: boolean;
    onSelect: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onMouseEnter: () => void;
    onToggleCollapsed: () => void;
    onStartTextEdit: () => void;
    onEditRichChange: (value: string, runs: StoryRichRun[]) => void;
    onCommitTextEdit: () => void;
    onCancelTextEdit: () => void;
    /** Enter while editing: commit and open a new row that continues the same kind (dialogue keeps speaker). */
    onContinue: () => void;
    /** Caret left the line's top/bottom/edge — move focus to the adjacent story row. */
    onArrowOut: (direction: "up" | "down" | "left" | "right") => void;
    /** Backspace on an empty line: demote dialogue → narration, or delete the row and step back. */
    onBackspaceAtEmptyStart: () => void;
    onOpenInspector: () => void;
    onCloseInspector: () => void;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    generateTextId: () => string;
    onCreateLayer: (beforeBlockId: StoryBlockId) => string | null;
    onInsertAfter: () => void;
    /** Insert a fresh child (action / menu option) at the end of this container. */
    onAddInside: (parentId: StoryBlockId) => void;
    /** Append an if / else-if / else branch to a condition container. */
    onAddBranch: (conditionId: StoryBlockId, branch: "if" | "elseIf" | "else") => void;
}) {
    const { t } = useTranslation();
    const { row, scene, document, characters, selected, active, collapsed, editing, textInputRef, inspectorOpen } = props;
    const block = row.block;
    const container = isContainerBlock(block);
    const containerInfo = container ? getContainerHeaderInfo(block) : null;
    const canFold = block.childrenIds.length > 0 && canAcceptChildren(block);
    const textSegment = getTextSegment(block);
    // Plain narration and studio notes hide their badge icon (but keep its slot, for alignment).
    const hideBadge = (block.kind === "nodeAction" && block.payload.action === "narration") || block.kind === "note";
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
        id: row.block.id,
    });
    const sortableStyle: CSSProperties = {
        transform: toSortableTransform(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.72 : undefined,
    };

    return (
        <div
            ref={setNodeRef}
            style={sortableStyle}
            data-story-row-block-id={block.id}
            className={[
                "group relative grid min-h-[35px] grid-cols-[36px_28px_1fr] items-start border-l-2 pr-3",
                selected ? "border-primary bg-primary/20" : active ? "border-primary bg-white/[0.035]" : "border-transparent hover:bg-white/[0.025]",
            ].join(" ")}
            onClick={props.onSelect}
            onMouseDown={props.onMouseDown}
            onMouseEnter={props.onMouseEnter}
            onDoubleClick={event => {
                event.stopPropagation();
                textSegment ? props.onStartTextEdit() : props.onOpenInspector();
            }}
        >
            <div className="flex h-full items-start justify-end pt-1 text-[12px] tabular-nums text-fg-subtle">
                <div className="flex min-h-[27px] items-center gap-1">
                    {canFold ? (
                        <button
                            type="button"
                            className="rounded text-fg-subtle hover:bg-fill hover:text-primary"
                            onClick={event => {
                                event.stopPropagation();
                                props.onToggleCollapsed();
                            }}
                        >
                            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                    ) : (
                        <span className="h-3.5 w-3.5" />
                    )}
                    <span>{row.lineNumber}</span>
                </div>
            </div>
            <div className="flex self-stretch items-center justify-center">
                <div
                    ref={setActivatorNodeRef}
                    {...attributes}
                    {...listeners}
                    role="button"
                    tabIndex={0}
                    aria-label={t("story.rows.dragRow")}
                    title={t("story.rows.dragRow")}
                    className="flex h-7 w-7 touch-none select-none items-center justify-center rounded text-fg-subtle opacity-0 transition-colors hover:cursor-grab hover:text-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 group-hover:opacity-100"
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                >
                    <GripVertical className="pointer-events-none h-4 w-4" />
                </div>
            </div>
            <div className="relative min-w-0 py-1">
                <RailGuides depth={row.depth} highlight={selected || active} />
                <div style={{ paddingLeft: row.depth * RAIL_STEP }}>
                <div className="flex min-h-[27px] min-w-0 items-center gap-2">
                    {containerInfo ? (
                        <ContainerPill info={containerInfo} />
                    ) : hideBadge ? (
                        <span className="h-6 w-6 shrink-0" aria-hidden />
                    ) : (
                        <BlockBadge block={block} characters={characters} />
                    )}
                    {containerInfo?.role === "branch" && containerInfo.hasCondition ? (
                        <ConditionChip
                            block={block}
                            scene={scene}
                            document={document}
                            onUpdatePayload={props.onUpdatePayload}
                        />
                    ) : null}
                    {containerInfo?.repeatTimes !== undefined ? (
                        <RepeatTimesField block={block} onUpdatePayload={props.onUpdatePayload} />
                    ) : null}
                    {editing && textSegment ? (
                        <TextEditBox
                            editorRef={textInputRef}
                            initialCaret={props.editInitialCaret}
                            onEditRichChange={props.onEditRichChange}
                            onCommitTextEdit={props.onCommitTextEdit}
                            onCancelTextEdit={props.onCancelTextEdit}
                            onContinue={props.onContinue}
                            onArrowOut={props.onArrowOut}
                            onBackspaceAtEmptyStart={props.onBackspaceAtEmptyStart}
                            onInsertAfter={props.onInsertAfter}
                            block={block}
                            scene={scene}
                            document={document}
                            characters={characters}
                            onSetDialogueCharacter={props.onSetDialogueCharacter}
                        />
                    ) : textSegment || !containerInfo ? (
                        <BlockPreview
                            block={block}
                            scene={scene}
                            document={document}
                            characters={characters}
                            onSetDialogueCharacter={props.onSetDialogueCharacter}
                            onTextDoubleClick={props.onStartTextEdit}
                        />
                    ) : null}
                    {containerInfo ? (
                        <ContainerHeaderAdd info={containerInfo} onAdd={() => props.onAddInside(block.id)} />
                    ) : (
                        <RowActions onInsertAfter={props.onInsertAfter} />
                    )}
                </div>
                {containerInfo ? (
                    <ContainerFooter
                        block={block}
                        info={containerInfo}
                        onAddInside={() => props.onAddInside(block.id)}
                        onAddBranch={branch => props.onAddBranch(block.id, branch)}
                    />
                ) : null}
                {inspectorOpen ? (
                    <ActionInspector
                        block={block}
                        document={document}
                        sceneId={scene.id}
                        characters={characters}
                        onUpdatePayload={props.onUpdatePayload}
                        onClose={props.onCloseInspector}
                        onSetDialogueCharacter={props.onSetDialogueCharacter}
                        generateTextId={props.generateTextId}
                        onCreateLayer={props.onCreateLayer}
                    />
                ) : null}
                </div>
            </div>
        </div>
    );
}

function editorPlaceholder(block: StoryBlock, t: ReturnType<typeof useTranslation>["t"]): string {
    switch (getTextSegment(block)?.role) {
        case "dialogue": return t("story.rows.placeholderDialogue");
        case "narration": return t("story.rows.placeholderNarration");
        case "choicePrompt": return t("story.rows.placeholderChoicePrompt");
        case "choiceText": return t("story.rows.placeholderChoiceText");
        case "note": return t("story.rows.placeholderNote");
        default: return t("story.rows.placeholderText");
    }
}

function TextEditBox(props: {
    editorRef: RefObject<RichTextInputHandle | null>;
    initialCaret?: "start" | "end";
    onEditRichChange: (value: string, runs: StoryRichRun[]) => void;
    onCommitTextEdit: () => void;
    onCancelTextEdit: () => void;
    onContinue: () => void;
    onArrowOut: (direction: "up" | "down" | "left" | "right") => void;
    onBackspaceAtEmptyStart: () => void;
    onInsertAfter: () => void;
    block: StoryBlock;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    onSetDialogueCharacter: (characterId: string | undefined) => void;
}) {
    const { t } = useTranslation();
    const dialoguePayload = props.block.kind === "nodeAction" && props.block.payload.action === "dialogue"
        ? props.block.payload
        : null;
    const initialRuns = useMemo(() => segmentToRuns(getTextSegment(props.block)), [props.block]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const { context, isInitialized } = useWorkspace();
    const [persistentVars, setPersistentVars] = useState<PersistentVariableOption[]>([]);
    useEffect(() => {
        if (!context || !isInitialized) return;
        const service = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const read = () =>
            setPersistentVars(
                service.listPersistentVariables().map(variable => ({
                    storageKey: variable.storageKey,
                    name: variable.name,
                    valueType: (variable.valueType as PersistentVariableOption["valueType"]) ?? "string",
                })),
            );
        read();
        return service.onBlueprintHistoryChanged(read);
    }, [context, isInitialized]);
    const variableOptions = useMemo(
        () => collectStoryVariableOptions(props.document, props.scene.id, persistentVars),
        [props.document, props.scene.id, persistentVars],
    );
    const resolveInterpolationLabel = useMemo(
        () => (interp: Parameters<typeof resolveInterpolationName>[3]) =>
            resolveInterpolationName(props.document, props.scene.id, persistentVars, interp),
        [props.document, props.scene.id, persistentVars],
    );
    const [interpEdit, setInterpEdit] = useState<InterpolationClickInfo | null>(null);
    // While a toolbar popover (color palette, pause config) is open, blur must not commit.
    const commitGuardRef = useRef(false);
    // Timestamp of the most recent pointerdown on the floating toolbar. Any blur that follows
    // shortly after is a toolbar interaction (bold/italic/color/pause/expand) and must NOT commit —
    // this is robust even when the pressed control (e.g. the collapse chip) unmounts and focus
    // falls to <body>.
    const lastToolbarInteractRef = useRef(0);
    const [pauseEdit, setPauseEdit] = useState<PauseClickInfo | null>(null);
    const [activeMarks, setActiveMarks] = useState<ActiveMarks>({ bold: false, italic: false });
    const textStyle = useStoryEditorTextStyle();

    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if ((event.target as HTMLElement | null)?.closest?.("[data-rt-toolbar]")) {
                lastToolbarInteractRef.current = performance.now();
            }
        };
        globalThis.document.addEventListener("pointerdown", onPointerDown, true);
        return () => globalThis.document.removeEventListener("pointerdown", onPointerDown, true);
    }, []);

    const openPause = (info: PauseClickInfo) => {
        commitGuardRef.current = true;
        setPauseEdit(info);
    };
    const closePause = () => {
        commitGuardRef.current = false;
        setPauseEdit(null);
        props.editorRef.current?.focus();
    };

    const openInterp = (info: InterpolationClickInfo) => {
        commitGuardRef.current = true;
        setInterpEdit(info);
    };
    const closeInterp = () => {
        commitGuardRef.current = false;
        setInterpEdit(null);
        props.editorRef.current?.focus();
    };

    const handleBlur = () => {
        // Defer so focus can settle.
        window.setTimeout(() => {
            if (performance.now() - lastToolbarInteractRef.current < 500) {
                // Toolbar interaction — keep editing and restore focus to the editor.
                props.editorRef.current?.focus();
                return;
            }
            if (commitGuardRef.current) {
                return;
            }
            const active = globalThis.document.activeElement;
            if (containerRef.current && active && containerRef.current.contains(active)) {
                return;
            }
            props.onCommitTextEdit();
        }, 0);
    };

    return (
        <div ref={containerRef} className="relative flex min-w-0 flex-1 items-stretch overflow-visible rounded border border-primary/50 bg-black/30">
            <RichTextToolbar editor={props.editorRef} anchorRef={containerRef} commitGuard={commitGuardRef} active={activeMarks} hasVariables={variableOptions.scene.length + variableOptions.saved.length + variableOptions.persistent.length > 0} />
            {dialoguePayload ? (
                <CharacterSelectTrigger
                    characters={props.characters}
                    characterId={dialoguePayload.characterId}
                    onChoose={props.onSetDialogueCharacter}
                    className="min-w-[128px] max-w-[200px] rounded-r-none border-r border-edge px-2"
                    style={textStyle}
                />
            ) : null}
            <RichTextInput
                ref={props.editorRef}
                initialRuns={initialRuns}
                initialCaret={props.initialCaret}
                className="min-h-[28px] flex-1 whitespace-pre-wrap break-words bg-transparent px-2 py-1 text-fg outline-none empty:before:italic empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]"
                style={textStyle}
                placeholder={editorPlaceholder(props.block, t)}
                onChange={props.onEditRichChange}
                onBlur={handleBlur}
                onCancel={props.onCancelTextEdit}
                onEnter={props.onContinue}
                onModEnter={() => { props.onCommitTextEdit(); props.onInsertAfter(); }}
                onArrowOut={props.onArrowOut}
                onBackspaceAtEmptyStart={props.onBackspaceAtEmptyStart}
                onPauseClick={openPause}
                onInterpolationClick={openInterp}
                resolveInterpolationLabel={resolveInterpolationLabel}
                onActiveMarksChange={setActiveMarks}
            />
            {pauseEdit ? (
                <PausePopover
                    anchor={pauseEdit.anchor}
                    value={pauseEdit.value}
                    onChange={pause => {
                        props.editorRef.current?.updatePauseAt(pauseEdit.unit, pause);
                        setPauseEdit(current => (current ? { ...current, value: pause } : current));
                    }}
                    onRemove={() => {
                        props.editorRef.current?.removePauseAt(pauseEdit.unit);
                        closePause();
                    }}
                    onClose={closePause}
                />
            ) : null}
            {interpEdit ? (
                <InterpolationPopover
                    anchor={interpEdit.anchor}
                    value={interpEdit.value}
                    options={variableOptions}
                    onChange={interp => {
                        props.editorRef.current?.updateInterpolationAt(interpEdit.unit, interp);
                        setInterpEdit(current => (current ? { ...current, value: interp } : current));
                    }}
                    onRemove={() => {
                        props.editorRef.current?.removeInterpolationAt(interpEdit.unit);
                        closeInterp();
                    }}
                    onClose={closeInterp}
                    onCommitTextEdit={props.onCommitTextEdit}
                />
            ) : null}
        </div>
    );
}

function RowActions(props: { onInsertAfter: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <button type="button" tabIndex={-1} className="rounded px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill hover:text-primary" onClick={event => {
                event.stopPropagation();
                props.onInsertAfter();
            }}>
                {t("story.rows.insert")}
            </button>
        </div>
    );
}

// --- Control-flow container rendering: accordion headers + visual indent rails. ---

/** Indent step (px) per nesting level. Each level draws a vertical guide rail. */
const RAIL_STEP = 20;

/** Vertical guide rails, one per ancestor nesting level, so nesting reads at a glance. */
function RailGuides({ depth, highlight }: { depth: number; highlight: boolean }) {
    if (depth <= 0) {
        return null;
    }
    return (
        <>
            {Array.from({ length: depth }).map((_, index) => (
                <span
                    key={index}
                    aria-hidden
                    className={[
                        "pointer-events-none absolute inset-y-0 w-px",
                        highlight && index === depth - 1 ? "bg-primary/40" : "bg-edge",
                    ].join(" ")}
                    style={{ left: index * RAIL_STEP + 9 }}
                />
            ))}
        </>
    );
}

const CONTAINER_PILL_TONE: Record<StoryContainerHeaderInfo["role"], string> = {
    condition: "border-[#b2a6c9]/40 bg-[#b2a6c9]/10 text-[#d0c8e0]",
    branch: "border-[#b2a6c9]/40 bg-[#b2a6c9]/10 text-[#d0c8e0]",
    group: "border-[#96b8a0]/40 bg-[#96b8a0]/10 text-[#bcd6c2]",
    menu: "border-[#9bb7d8]/40 bg-[#9bb7d8]/10 text-[#c6d7ee]",
    option: "border-[#9bb7d8]/40 bg-[#9bb7d8]/10 text-[#c6d7ee]",
    nvl: "border-edge bg-fill-subtle text-fg-muted",
};

/** The plain-language label pill that titles a control-flow container header. */
function ContainerPill({ info }: { info: StoryContainerHeaderInfo }) {
    return (
        <span
            className={[
                "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-2xs font-medium",
                CONTAINER_PILL_TONE[info.role],
            ].join(" ")}
        >
            {info.role === "option" ? <span aria-hidden className="text-[10px] leading-none">○</span> : null}
            {info.pill}
        </span>
    );
}

type StoryT = ReturnType<typeof useTranslation>["t"];

function conditionOperatorLabel(operator: string, t: StoryT): string {
    switch (operator) {
        case "isTrue": return t("story.condition.opIsOn");
        case "isFalse": return t("story.condition.opIsOff");
        case "equals": return t("story.condition.opEquals");
        case "notEquals": return t("story.condition.opNotEquals");
        case "exists": return t("story.condition.opExists");
        default: return operator;
    }
}

/** Compact, user-safe one-line summary of a branch condition (never exposes ids). */
function conditionSummary(condition: unknown, scene: StoryScene, document: StoryDocument, t: StoryT): string {
    const value = condition as
        | { kind: "variable"; target: { scope: string; variableId?: string; storageKey?: string }; operator: string; value?: unknown }
        | { kind: "blueprint"; blueprintId: string }
        | { kind: "expression"; source: string }
        | undefined;
    if (!value) {
        return t("story.condition.summarySet");
    }
    if (value.kind === "blueprint") {
        return t("story.condition.summaryGraph");
    }
    if (value.kind === "expression") {
        return value.source || t("story.condition.summaryExpression");
    }
    const target = value.target;
    const name = target.scope === "scene"
        ? scene.sceneVariables?.[target.variableId ?? ""]?.name ?? t("story.condition.fallbackVariable")
        : target.scope === "saved"
          ? document.savedVariables?.[target.variableId ?? ""]?.name ?? t("story.condition.fallbackVariable")
          : t("story.condition.fallbackPersistent");
    const operator = conditionOperatorLabel(value.operator, t);
    const suffix = value.operator === "equals" || value.operator === "notEquals" ? ` ${String(value.value ?? "")}` : "";
    return `${name} ${operator}${suffix}`.trim();
}

/** Editable condition chip on a branch header — opens the inline condition popover. */
function ConditionChip(props: {
    block: StoryBlock;
    scene: StoryScene;
    document: StoryDocument;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    const [anchor, setAnchor] = useState<{ top: number; left: number; bottom: number } | null>(null);
    const block = props.block;
    if (block.kind !== "control" || block.payload.control !== "conditionBranch") {
        return null;
    }
    const payload = block.payload;
    const openPopover = (event: MouseEvent) => {
        event.stopPropagation();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        setAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
    };
    return (
        <>
            <button
                type="button"
                className="min-w-0 max-w-[240px] truncate rounded border border-edge bg-black/20 px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-primary/50 hover:text-fg"
                onClick={openPopover}
                onMouseDown={event => event.stopPropagation()}
            >
                {conditionSummary(payload.condition, props.scene, props.document, t)}
            </button>
            {anchor ? (
                <ConditionPopover
                    anchor={anchor}
                    document={props.document}
                    sceneId={props.scene.id}
                    value={payload.condition}
                    onChange={condition => props.onUpdatePayload({ ...payload, condition })}
                    onClear={() => {
                        props.onUpdatePayload({ ...payload, condition: undefined });
                        setAnchor(null);
                    }}
                    onClose={() => setAnchor(null)}
                />
            ) : null}
        </>
    );
}

/** Inline repeat-count stepper on a repeat group header. */
function RepeatTimesField(props: { block: StoryBlock; onUpdatePayload: (payload: StoryBlock["payload"]) => void }) {
    const { t } = useTranslation();
    const block = props.block;
    if (block.kind !== "control" || block.payload.control !== "repeat") {
        return null;
    }
    const payload = block.payload;
    return (
        <label
            className="flex shrink-0 items-center gap-1 text-xs text-fg-muted"
            onClick={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
        >
            <input
                type="number"
                min={0}
                value={payload.times ?? 1}
                onChange={event =>
                    props.onUpdatePayload({ ...payload, times: Math.max(0, Math.floor(Number(event.target.value) || 0)) })
                }
                className="w-14 rounded border border-edge bg-black/20 px-1.5 py-0.5 text-fg outline-none focus:border-primary/50"
            />
            <span>{t("story.repeat.times")}</span>
        </label>
    );
}

/** Hover "+ Add" affordance on the right of a non-condition container header (adds a child at the end). */
function ContainerHeaderAdd(props: { info: StoryContainerHeaderInfo; onAdd: () => void }) {
    const { t } = useTranslation();
    if (props.info.role === "condition") {
        return null;
    }
    const label = props.info.role === "menu" ? t("story.container.addOption") : t("story.container.addAction");
    return (
        <div className="pointer-events-none ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <button
                type="button"
                tabIndex={-1}
                title={label}
                className="rounded px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill hover:text-primary"
                onClick={event => {
                    event.stopPropagation();
                    props.onAdd();
                }}
            >
                + {label}
            </button>
        </div>
    );
}

/** Footer affordances under a container header: empty-body add prompt, and branch management for conditions. */
function ContainerFooter(props: {
    block: StoryBlock;
    info: StoryContainerHeaderInfo;
    onAddInside: () => void;
    onAddBranch: (branch: "if" | "elseIf" | "else") => void;
}) {
    const { t } = useTranslation();
    const empty = props.block.childrenIds.length === 0;
    if (props.info.role === "condition") {
        return (
            <div className="mt-1 flex items-center gap-3 text-2xs text-fg-subtle" style={{ paddingLeft: RAIL_STEP }}>
                <button
                    type="button"
                    className="rounded px-1.5 py-0.5 hover:bg-fill hover:text-primary"
                    onClick={event => {
                        event.stopPropagation();
                        props.onAddBranch("elseIf");
                    }}
                >
                    + {t("story.container.elseIf")}
                </button>
                <button
                    type="button"
                    className="rounded px-1.5 py-0.5 hover:bg-fill hover:text-primary"
                    onClick={event => {
                        event.stopPropagation();
                        props.onAddBranch("else");
                    }}
                >
                    + {t("story.container.elseBranch")}
                </button>
            </div>
        );
    }
    if (!empty) {
        return null;
    }
    const label = props.info.role === "menu" ? t("story.container.addOptionInside") : t("story.container.addActionInside");
    return (
        <button
            type="button"
            className="mt-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs italic text-fg-subtle hover:bg-fill hover:text-fg-muted"
            style={{ marginLeft: RAIL_STEP }}
            onClick={event => {
                event.stopPropagation();
                props.onAddInside();
            }}
        >
            <Plus className="h-3 w-3" />
            {label}
        </button>
    );
}

export function InsertRow(props: {
    mode: Extract<EditorMode, { kind: "insert" }>;
    characters: Character[];
    inputRef: RefObject<HTMLTextAreaElement | null>;
    onValueChange: (value: string) => void;
    onCommitNarration: (focusNext: boolean) => void;
    onCancelActionChooser: () => void;
    onChooseCommand: (commandId: string) => void;
    onChooseCharacter: (characterId: string) => void;
    /** Backspace on the empty slot — dismiss it and step back to the row above. */
    onBackspaceEmpty: () => void;
}) {
    const { t } = useTranslation();
    const chooserQuery = props.mode.value.slice(1);
    const menuAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuPlacement = useAutoMenuPlacement(menuAnchorRef, props.mode.chooser !== "none", 312);
    const pluginCommands = useStoryPluginActionCommands();
    const actionOptions = useMemo<PaletteActionCommand[]>(
        () => [...ACTION_COMMANDS, ...pluginCommands]
            .map(command => localizeActionCommand(command, t))
            .filter(command => actionCommandMatchesQuery(command, chooserQuery)),
        [chooserQuery, pluginCommands, t],
    );
    const characterOptions = useMemo(() => getCharacterOptions(props.characters, chooserQuery), [props.characters, chooserQuery]);
    const actionMenu = useActionCommandMenuState(actionOptions);
    const characterMenu = useCharacterPickerState(characterOptions);
    const textStyle = useStoryEditorTextStyle();

    return (
        <div className="relative grid min-h-[40px] grid-cols-[36px_28px_1fr] items-start pr-3">
            <div className="pt-2 text-right text-[12px] text-fg-subtle">+</div>
            <div className="flex justify-center pt-2">
                <Plus className="h-4 w-4 text-primary" />
            </div>
            <div ref={menuAnchorRef} className="relative py-1.5">
                <textarea
                    ref={props.inputRef}
                    className="min-h-[30px] w-full resize-none rounded border border-primary/40 bg-black/30 px-2 py-1 text-fg outline-none placeholder:italic placeholder:text-fg-subtle"
                    style={textStyle}
                    rows={1}
                    value={props.mode.value}
                    placeholder={t("story.rows.insertPlaceholder")}
                    onChange={event => props.onValueChange(event.target.value)}
                    onBlur={() => {
                        if (props.mode.chooser === "none") {
                            props.onCommitNarration(false);
                        }
                    }}
                    onKeyDown={event => {
                        if (event.key === "Backspace" && props.mode.value === "" && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                            event.preventDefault();
                            props.onBackspaceEmpty();
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            props.mode.chooser === "action" ? props.onCancelActionChooser() : props.onCommitNarration(false);
                            return;
                        }
                        if (props.mode.chooser === "action") {
                            if (event.key === "Tab") {
                                event.preventDefault();
                                actionMenu.moveCategory(event.shiftKey ? -1 : 1);
                                return;
                            }
                            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                                event.preventDefault();
                                actionMenu.moveCategory(event.key === "ArrowLeft" ? -1 : 1);
                                return;
                            }
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                event.preventDefault();
                                actionMenu.moveCommand(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                        }
                        if (props.mode.chooser === "character" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                            event.preventDefault();
                            characterMenu.moveCharacter(event.key === "ArrowDown" ? 1 : -1);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            if (event.shiftKey) {
                                return;
                            }
                            if (props.mode.chooser === "action") {
                                const command = actionMenu.activeCommand;
                                command ? props.onChooseCommand(command.id) : props.onCommitNarration(true);
                                return;
                            }
                            if (props.mode.chooser === "character") {
                                const character = characterMenu.activeCharacter;
                                character ? props.onChooseCharacter(character.profile.getId()) : props.onCommitNarration(true);
                                return;
                            }
                            props.onCommitNarration(true);
                        }
                    }}
                />
                {props.mode.chooser === "action" ? (
                    <ActionCommandMenu
                        categories={actionMenu.visibleCategories}
                        activeCategoryId={actionMenu.activeCategoryId}
                        activeCommandId={actionMenu.activeCommand?.id ?? null}
                        onSelectCategory={actionMenu.selectCategory}
                        onHighlightCommand={actionMenu.selectCommand}
                        onChoose={props.onChooseCommand}
                        onCancel={props.onCancelActionChooser}
                        placement={menuPlacement}
                    />
                ) : null}
                {props.mode.chooser === "character" ? (
                    <CharacterPicker
                        characters={characterOptions}
                        activeCharacterId={characterMenu.activeCharacter?.profile.getId() ?? null}
                        onHighlight={characterMenu.selectCharacter}
                        onChoose={props.onChooseCharacter}
                        onClear={() => props.onCommitNarration(false)}
                        placement={menuPlacement}
                    />
                ) : null}
            </div>
        </div>
    );
}

function getCharacterOptions(characters: Character[], query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    return characters.filter(character => {
        const name = character.profile.getName().toLowerCase();
        return !normalizedQuery || name.includes(normalizedQuery);
    });
}

type VisibleActionCommandCategory = ActionCommandCategory & {
    commands: PaletteActionCommand[];
};

type PopupPlacement = "above" | "below";

function useAutoMenuPlacement(anchorRef: RefObject<HTMLElement | null>, open: boolean, expectedHeight: number): PopupPlacement {
    const [placement, setPlacement] = useState<PopupPlacement>("below");

    useEffect(() => {
        if (!open) {
            return;
        }
        const updatePlacement = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            const gap = 8;
            const spaceBelow = window.innerHeight - rect.bottom - gap;
            const spaceAbove = rect.top - gap;
            setPlacement(spaceBelow < expectedHeight && spaceAbove > spaceBelow ? "above" : "below");
        };
        updatePlacement();
        const raf = window.requestAnimationFrame(updatePlacement);
        window.addEventListener("resize", updatePlacement);
        window.addEventListener("scroll", updatePlacement, true);
        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", updatePlacement);
            window.removeEventListener("scroll", updatePlacement, true);
        };
    }, [anchorRef, expectedHeight, open]);

    return placement;
}

function getPopupPlacementClass(placement: PopupPlacement): string {
    return placement === "above" ? "bottom-full mb-1" : "top-full mt-1";
}

function useActionCommandMenuState(options: PaletteActionCommand[]) {
    const visibleCategories = useMemo<VisibleActionCommandCategory[]>(() => {
        return ACTION_COMMAND_CATEGORIES.map(category => ({
            ...category,
            commands: category.id === "all"
                ? options
                : options.filter(command => command.category === category.id),
        }));
    }, [options]);
    const [activeCategoryId, setActiveCategoryId] = useState<ActionCommandCategoryId>("all");
    const [activeCommandId, setActiveCommandId] = useState<string | null>(null);

    const activeCategory = visibleCategories.find(category => category.id === activeCategoryId) ?? visibleCategories[0] ?? null;
    const activeCommand = activeCategory?.commands.find(command => command.id === activeCommandId) ?? activeCategory?.commands[0] ?? null;

    useEffect(() => {
        if (visibleCategories.length === 0) {
            setActiveCommandId(null);
            return;
        }
        setActiveCategoryId(current => visibleCategories.some(category => category.id === current) ? current : visibleCategories[0].id);
    }, [visibleCategories]);

    useEffect(() => {
        if (!activeCategory) {
            setActiveCommandId(null);
            return;
        }
        setActiveCommandId(current => activeCategory.commands.some(command => command.id === current) ? current : activeCategory.commands[0]?.id ?? null);
    }, [activeCategory]);

    const selectCategory = (categoryId: ActionCommandCategoryId) => {
        const category = visibleCategories.find(next => next.id === categoryId);
        if (!category) {
            return;
        }
        setActiveCategoryId(category.id);
        setActiveCommandId(category.commands[0]?.id ?? null);
    };

    const selectCommand = (commandId: string) => {
        setActiveCommandId(commandId);
    };

    const moveCategory = (direction: -1 | 1) => {
        if (visibleCategories.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, visibleCategories.findIndex(category => category.id === activeCategoryId));
        const nextIndex = (currentIndex + direction + visibleCategories.length) % visibleCategories.length;
        const nextCategory = visibleCategories[nextIndex];
        setActiveCategoryId(nextCategory.id);
        setActiveCommandId(nextCategory.commands[0]?.id ?? null);
    };

    const moveCommand = (direction: -1 | 1) => {
        if (!activeCategory || activeCategory.commands.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, activeCategory.commands.findIndex(command => command.id === activeCommand?.id));
        const nextIndex = (currentIndex + direction + activeCategory.commands.length) % activeCategory.commands.length;
        setActiveCommandId(activeCategory.commands[nextIndex].id);
    };

    return {
        visibleCategories,
        activeCategoryId: activeCategory?.id ?? activeCategoryId,
        activeCommand,
        selectCategory,
        selectCommand,
        moveCategory,
        moveCommand,
    };
}

function ActionCommandMenu(props: {
    categories: VisibleActionCommandCategory[];
    activeCategoryId: ActionCommandCategoryId;
    activeCommandId: string | null;
    onSelectCategory: (categoryId: ActionCommandCategoryId) => void;
    onHighlightCommand: (commandId: string) => void;
    onChoose: (commandId: string) => void;
    onCancel: () => void;
    placement: PopupPlacement;
}) {
    const { t } = useTranslation();
    const activeCategory = props.categories.find(category => category.id === props.activeCategoryId) ?? props.categories[0] ?? null;
    const listRef = useRef<HTMLDivElement | null>(null);
    const categoryListRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!activeCategory) {
            return;
        }
        window.requestAnimationFrame(() => {
            const root = categoryListRef.current;
            const activeTab = root?.querySelector(`[data-action-category-id="${activeCategory.id}"]`);
            activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    }, [activeCategory?.id]);

    useEffect(() => {
        if (!props.activeCommandId) {
            return;
        }
        window.requestAnimationFrame(() => {
            const root = listRef.current;
            const activeItem = root?.querySelector(`[data-action-command-id="${props.activeCommandId}"]`);
            activeItem?.scrollIntoView({ block: "nearest" });
        });
    }, [activeCategory?.id, props.activeCommandId]);

    return (
        <div
            className={["absolute left-0 z-50 w-[420px] overflow-hidden rounded-xl border border-edge bg-[#181b20] shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.categories.length === 0 ? (
                <button type="button" className="w-full px-3 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onCancel}>
                    {t("story.actionCreator.noActions")}
                </button>
            ) : (
                <>
                    <div ref={categoryListRef} className="flex overflow-x-auto border-b border-edge bg-surface" role="tablist" aria-label={t("story.rows.actionTypes")}>
                        {props.categories.map(category => {
                            const active = category.id === activeCategory?.id;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    data-action-category-id={category.id}
                                    className={[
                                        "relative flex h-9 min-w-[74px] flex-none cursor-default items-center justify-center px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                                        active ? "bg-[#151922] text-white" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                                    ].join(" ")}
                                    onMouseDown={() => props.onSelectCategory(category.id)}
                                >
                                    <span className="block truncate">{translateActionCommandCategoryLabel(category, t)}</span>
                                    {active ? <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary/70" aria-hidden /> : null}
                                </button>
                            );
                        })}
                    </div>
                    <div ref={listRef} className="max-h-64 overflow-auto p-1">
                        {activeCategory && activeCategory.commands.length === 0 ? (
                            <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onCancel}>
                                {t("story.rows.noCategoryActionFound", { category: translateActionCommandCategoryLabel(activeCategory, t).toLowerCase() })}
                            </button>
                        ) : activeCategory?.commands.map(command => {
                            const Icon = command.icon;
                            const active = command.id === props.activeCommandId;
                            const category = getActionCommandCategory(command.category);
                            return (
                                <button
                                    key={command.id}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    data-action-command-id={command.id}
                                    className={[
                                        "flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors",
                                        active ? "bg-primary/15 text-white" : "hover:bg-fill",
                                    ].join(" ")}
                                    onMouseDown={() => props.onChoose(command.id)}
                                    onMouseEnter={() => props.onHighlightCommand(command.id)}
                                >
                                    <Icon className="h-4 w-4 shrink-0" style={{ color: category.iconColor }} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-fg">{command.label}</span>
                                        <span className="block truncate text-2xs text-fg-subtle">{command.detail}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

function useCharacterPickerState(characters: Character[]) {
    const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
    const activeCharacter = characters.find(character => character.profile.getId() === activeCharacterId) ?? characters[0] ?? null;

    useEffect(() => {
        if (characters.length === 0) {
            setActiveCharacterId(null);
            return;
        }
        setActiveCharacterId(current => characters.some(character => character.profile.getId() === current) ? current : characters[0].profile.getId());
    }, [characters]);

    const selectCharacter = (characterId: string) => {
        setActiveCharacterId(characterId);
    };

    const moveCharacter = (direction: -1 | 1) => {
        if (characters.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, characters.findIndex(character => character.profile.getId() === activeCharacter?.profile.getId()));
        const nextIndex = (currentIndex + direction + characters.length) % characters.length;
        setActiveCharacterId(characters[nextIndex].profile.getId());
    };

    return {
        activeCharacter,
        selectCharacter,
        moveCharacter,
    };
}

function CharacterPicker(props: {
    characters: Character[];
    activeCharacterId: string | null;
    onHighlight: (characterId: string) => void;
    onChoose: (characterId: string) => void;
    onClear: () => void;
    placement: PopupPlacement;
}) {
    const { t } = useTranslation();
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!props.activeCharacterId) {
            return;
        }
        window.requestAnimationFrame(() => {
            const root = listRef.current;
            const activeItem = root?.querySelector(`[data-character-id="${props.activeCharacterId}"]`);
            activeItem?.scrollIntoView({ block: "nearest" });
        });
    }, [props.activeCharacterId]);

    return (
        <div
            ref={listRef}
            className={["absolute left-0 z-50 max-h-72 w-[320px] overflow-auto rounded-xl border border-edge bg-[#181b20] p-1 shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.characters.length === 0 ? (
                <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onClear}>
                    {t("story.rows.noCharacterFound")}
                </button>
            ) : (
                props.characters.map(character => {
                    const characterId = character.profile.getId();
                    const active = characterId === props.activeCharacterId;
                    return (
                        <button
                            key={characterId}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-character-id={characterId}
                            className={[
                                "flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors",
                                active ? "bg-primary/15 text-white" : "hover:bg-fill",
                            ].join(" ")}
                            onMouseEnter={() => props.onHighlight(characterId)}
                            onMouseDown={() => props.onChoose(characterId)}
                        >
                            <Hash className={["h-4 w-4 shrink-0", active ? "text-primary" : "text-primary/80"].join(" ")} />
                            <span className="truncate text-sm text-fg">{character.profile.getName()}</span>
                        </button>
                    );
                })
            )}
        </div>
    );
}

function CharacterSelectTrigger(props: {
    characters: Character[];
    characterId: string | undefined;
    onChoose: (characterId: string | undefined) => void;
    className?: string;
    style?: CSSProperties;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const picker = useCharacterPickerState(props.characters);
    const placement = useAutoMenuPlacement(rootRef, open, 288);
    const label = getCharacterName(props.characters, props.characterId);
    const unassigned = !props.characterId;

    useEffect(() => {
        if (open && props.characterId) {
            picker.selectCharacter(props.characterId);
        }
    }, [open, props.characterId]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    return (
        <div ref={rootRef} className="relative shrink-0 overflow-visible">
            <button
                type="button"
                className={[
                    "flex h-full min-h-[28px] max-w-full items-center truncate rounded px-1 py-0.5 text-left text-sm hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                    unassigned ? "italic text-fg-subtle hover:text-primary" : "text-primary",
                    props.className ?? "",
                ].join(" ")}
                style={props.style}
                onMouseDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={event => {
                    event.stopPropagation();
                    setOpen(current => !current);
                }}
            >
                <span className="truncate">{label}</span>
            </button>
            {open ? (
                <CharacterPicker
                    characters={props.characters}
                    activeCharacterId={picker.activeCharacter?.profile.getId() ?? null}
                    onHighlight={picker.selectCharacter}
                    onChoose={characterId => {
                        props.onChoose(characterId);
                        setOpen(false);
                    }}
                    onClear={() => {
                        props.onChoose(undefined);
                        setOpen(false);
                    }}
                    placement={placement}
                />
            ) : null}
        </div>
    );
}

function BlockBadge({ block, characters }: { block: StoryBlock; characters: Character[] }) {
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);
    const characterId = block.kind === "nodeAction" && block.payload.action === "dialogue"
        ? block.payload.characterId
        : block.kind === "action" && block.payload.action === "character"
            ? block.payload.characterId
            : undefined;
    const character = characterId
        ? characters.find(next => next.profile.getId() === characterId)
        : undefined;
    const thumbnailId = character?.profile.getThumbnail() ?? null;
    const thumbnailUrl = useServiceAssetObjectUrl(thumbnailId);

    return (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded border border-edge bg-fill-subtle" title={label} aria-label={label}>
            {thumbnailUrl ? (
                <img
                    src={thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                />
            ) : (
                <Icon className="h-3.5 w-3.5" style={{ color: iconColor }} />
            )}
        </span>
    );
}

function useServiceAssetObjectUrl(fileId: string | null): string | null {
    const { context, isInitialized } = useWorkspace();
    const serviceAssets = useMemo(
        () => context && isInitialized ? context.services.get<ServiceAssetsService>(Services.ServiceAssets) : null,
        [context, isInitialized],
    );
    const [url, setUrl] = useState<string | null>(null);
    const urlRef = useRef<string | null>(null);

    useEffect(() => {
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
        setUrl(null);

        if (!fileId || !serviceAssets) {
            return;
        }

        let cancelled = false;

        (async () => {
            const result = await serviceAssets.readRaw(fileId);
            if (!result.ok || cancelled) {
                return;
            }

            const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)]));
            if (cancelled) {
                URL.revokeObjectURL(objectUrl);
                return;
            }

            urlRef.current = objectUrl;
            setUrl(objectUrl);
        })();

        return () => {
            cancelled = true;
        };
    }, [fileId, serviceAssets]);

    useEffect(() => {
        return () => {
            if (urlRef.current) {
                URL.revokeObjectURL(urlRef.current);
                urlRef.current = null;
            }
        };
    }, []);

    return url;
}

function toSortableTransform(transform: { x: number; y: number } | null): string | undefined {
    if (!transform) {
        return undefined;
    }
    // Translate vertically only. dnd-kit's FLIP layout animation encodes a size ratio in scaleX/scaleY
    // (oldRect.height / currentRect.height); applying it stretches a row to a neighbour's height — e.g.
    // when dragging past an expanded inspector — which visibly distorts the row. A vertical list only
    // needs the Y offset, so we drop the scale (and keep x at 0 so rows never drift sideways).
    return `translate3d(0, ${transform.y}px, 0)`;
}

function BlockPreview(props: {
    block: StoryBlock;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    onTextDoubleClick: () => void;
}) {
    const { t } = useTranslation();
    const block = props.block;
    const text = getTextSegment(block);
    const textStyle = useStoryEditorTextStyle();
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        const hasValue = Boolean(text?.value) || Boolean(text?.rich && text.rich.length > 0);
        return (
            <div className="flex min-w-0 items-baseline gap-2 text-sm">
                <CharacterSelectTrigger
                    characters={props.characters}
                    characterId={block.payload.characterId}
                    onChoose={props.onSetDialogueCharacter}
                    style={textStyle}
                />
                <span className={["min-w-0 flex-1 whitespace-pre-wrap break-words", hasValue ? "text-fg" : "italic text-fg-subtle"].join(" ")} style={textStyle} onDoubleClick={event => {
                    event.stopPropagation();
                    props.onTextDoubleClick();
                }}>
                    {hasValue && text ? <RichTextView segment={text} document={props.document} sceneId={props.scene.id} /> : t("story.rows.doubleClickDialogue")}
                </span>
            </div>
        );
    }
    if (text) {
        const hasValue = Boolean(text.value) || Boolean(text.rich && text.rich.length > 0);
        const note = block.kind === "note";
        return (
            <span className={["min-w-0 flex-1 whitespace-pre-wrap break-words", note ? "italic text-fg-muted" : hasValue ? "text-fg" : "italic text-fg-subtle"].join(" ")} style={textStyle} onDoubleClick={event => {
                event.stopPropagation();
                props.onTextDoubleClick();
            }}>
                {hasValue ? <RichTextView segment={text} document={props.document} sceneId={props.scene.id} /> : getEmptyTextPlaceholder(block)}
            </span>
        );
    }
    if (block.kind === "action" && block.payload.action === "setBackground") {
        return <BackgroundBlockPreview payload={block.payload} />;
    }
    if (block.kind === "action" && block.payload.action === "displayable" && block.payload.operation === "transform") {
        return (
            <DisplayableTransformPreview
                payload={block.payload}
                sceneId={props.scene.id}
                blockId={block.id}
                document={props.document}
                characters={props.characters}
                fallback={describeBlock(block, props.characters, props.scene, props.document.scenes)}
            />
        );
    }
    return <span className="min-w-0 flex-1 truncate text-sm text-fg-muted" style={textStyle}>{describeBlock(block, props.characters, props.scene, props.document.scenes)}</span>;
}

function BackgroundBlockPreview({ payload }: { payload: Extract<StoryActionPayload, { action: "setBackground" }> }) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const textStyle = useStoryEditorTextStyle();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const asset = payload.assetId ? assetsService?.getAssets()[AssetType.Image]?.[payload.assetId] ?? null : null;
    const { url } = useAssetObjectUrl(payload.assetId ?? null);
    const label = asset?.name ?? (payload.assetId ? t("story.background.missingImage") : payload.color || t("story.background.unassigned"));
    const isColor = !payload.assetId && Boolean(payload.color);

    return (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-muted" style={textStyle}>
            {payload.assetId ? (
                <span className="h-5 w-8 shrink-0 overflow-hidden rounded border border-edge bg-surface">
                    {url ? (
                        <img
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center">
                            <Image className="h-3 w-3 text-fg-subtle" />
                        </span>
                    )}
                </span>
            ) : isColor ? (
                <span
                    className="h-4 w-7 shrink-0 rounded border border-edge"
                    style={{ backgroundColor: payload.color }}
                />
            ) : null}
            <span className="min-w-0 truncate">
                {t("story.rows.setBackground")} <span className={payload.assetId || payload.color ? "text-fg" : "italic text-fg-subtle"}>{label}</span>
            </span>
        </span>
    );
}

function DisplayableTransformPreview(props: {
    payload: Extract<StoryActionPayload, { action: "displayable" }>;
    sceneId: StoryScene["id"];
    blockId: StoryBlock["id"];
    document: StoryDocument;
    characters: Character[];
    fallback: string;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const textStyle = useStoryEditorTextStyle();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );

    const target = props.payload.target;
    const resolved = useMemo(
        () => resolveStoryMotionPreviewTarget({
            document: props.document,
            sceneId: props.sceneId,
            blockId: props.blockId,
            fallbackKind: target.kind ?? "image",
            fallbackLabel: target.name,
        }),
        [props.document, props.sceneId, props.blockId, target.kind, target.name, target.sourceBlockId],
    );

    // Character displayables usually carry no assetId on their actions (the image comes from the
    // character profile), so fall back to the matched character's thumbnail to still show a face.
    const characterThumbId = useMemo(() => {
        if (resolved.assetId || resolved.kind !== "character") {
            return null;
        }
        const character = props.characters.find(next =>
            next.profile.getName().trim().toLowerCase() === resolved.label.trim().toLowerCase());
        return character?.profile.getThumbnail() ?? null;
    }, [resolved.assetId, resolved.kind, resolved.label, props.characters]);

    const assetId = resolved.assetId ?? characterThumbId;
    const asset = assetId ? assetsService?.getAssets()[AssetType.Image]?.[assetId] ?? null : null;
    const { url } = useAssetObjectUrl(assetId ?? null);
    // `resolved.label` already follows the stable anchor (and falls back to the stored name).
    const name = resolved.label;

    // No resolvable image (e.g. a text/layer target or an unresolved name) — keep the plain description.
    if (!assetId) {
        return <span className="min-w-0 flex-1 truncate text-sm text-fg-muted" style={textStyle}>{props.fallback}</span>;
    }

    return (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-muted" style={textStyle}>
            <span className="h-5 w-8 shrink-0 overflow-hidden rounded border border-edge bg-surface">
                {url ? (
                    <img
                        src={url}
                        alt=""
                        className="h-full w-full object-cover"
                        draggable={false}
                    />
                ) : (
                    <span className="flex h-full w-full items-center justify-center">
                        <Image className="h-3 w-3 text-fg-subtle" />
                    </span>
                )}
            </span>
            <span className="min-w-0 truncate">
                {t("story.rows.transform")} <span className="text-fg">{name}</span>
                {asset ? <span className="text-fg-subtle"> · {asset.name}</span> : null}
            </span>
        </span>
    );
}
