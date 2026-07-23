import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject, MouseEvent } from "react";
import { ChevronDown, ChevronRight, GripVertical, Hash, Image, Music, Play, Plus, Route, UserRoundPlus, Variable, Video } from "lucide-react";
import type { TempSpeakerRef } from "@/lib/workspace/services/story/storyModel";
import { useSortable } from "@dnd-kit/sortable";
import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryCharacterVariantSelection, StoryDocument, StoryRichRun, StoryScene } from "@shared/types/story";
import { resolveVariantEntry, selectCharacterVariantNames } from "@shared/utils/characterVariant";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import type { NormalizedCrop } from "@/lib/utils/headCrop";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { getCommandGhost } from "./storyCommandGhost";
import { getCommandLineDraftReason, getCommandLineReason } from "./storyCommandReason";
import { isMacPlatform } from "@/lib/app/platform";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useBadgeImageUrl, type BadgeImageSource } from "./storyBadgeImageCache";
import { resolveStoryMotionPreviewTarget } from "../../story-motion/storyMotionPreviewTarget";
import type { Character } from "@/lib/workspace/services/character/Character";
import {
    ACTION_COMMAND_CATEGORIES,
    ACTION_COMMANDS,
    getActionCommandCategory,
    localizeActionCommand,
    type ActionCommandCategory,
    type ActionCommandCategoryId,
    type PaletteActionCommand,
} from "./storyActionCommands";
import { searchActionCommands } from "./storyCommandSearch";
import { localizeSpecCommand, specPaletteCommands } from "./commands/specPalette";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { paramTypes } from "./storyCommandGrammar";
import { getCommandDef } from "./commands/registry";
import { completionFor, defaultHighlights, getCommandCursor, type StoryCommandCursor } from "./storyCommandCursor";
import { getCommandCandidates, hasCandidateSource, type StoryCommandCandidate } from "./storyCommandCandidates";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";
import { StoryCommandCandidateMenu, useStoryCandidateMenuState, type StoryCandidateItem } from "./StoryCommandCandidateMenu";
import { RichTextInput, type ActiveMarks, type InterpolationClickInfo, type PauseClickInfo, type RichTextInputHandle } from "./RichTextInput";
import { RichTextToolbar } from "./RichTextToolbar";
import { InterpolationPopover } from "./InterpolationPopover";
import { collectStoryVariableOptions, resolveInterpolationName, type PersistentVariableOption } from "./storyInterpolation";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { RichTextView } from "./RichTextView";
import { StoryVoiceIndicator } from "./StoryVoiceIndicator";
import { PausePopover } from "./PausePopover";
import { segmentToRuns } from "./richText";
import { useStoryEditorTextStyle } from "./storyEditorTextStyle";
import type { CharacterAppearanceRef, EditorMode, StoryCaretTarget, VisibleStoryRow } from "./storySceneEditorTypes";
import {
    canAcceptChildren,
    describeBlock,
    getBlockBadgeInfo,
    getCharacterColor,
    getCharacterName,
    getContainerHeaderInfo,
    getEmptyTextPlaceholder,
    getTextSegment,
    isContainerBlock,
    type StoryContainerHeaderInfo,
} from "./storySceneBlockUtils";
import { ConditionPopover } from "./ConditionPopover";
import { getQuickParams, QuickParamsInline, QuickParamsSummary, type QuickParam } from "./storyQuickParams";
import { actionTrigger, ACTION_TRIGGER, toCanonicalCommandLine } from "./commandTrigger";

export function StoryBlockRow(props: {
    row: VisibleStoryRow;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    /** What a name on a draft line may refer to - the reason line resolves against the same view the slot does. */
    commandContext: StoryCommandContext;
    selected: boolean;
    active: boolean;
    collapsed: boolean;
    editing: boolean;
    /** Where the caret lands when this row opens for editing (arrow-navigation, or a carried selection). */
    editInitialCaret?: StoryCaretTarget;
    textInputRef: RefObject<RichTextInputHandle | null>;
    onSelect: (event: MouseEvent) => void;
    onContextMenu: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onMouseEnter: () => void;
    onToggleCollapsed: () => void;
    onStartTextEdit: () => void;
    onEditRichChange: (value: string, runs: StoryRichRun[]) => void;
    onCommitTextEdit: () => void;
    onExitTextEdit: () => void;
    /** Enter while editing: commit and open a new row that continues the same kind (dialogue keeps speaker). */
    onContinue: () => void;
    /** Caret left the line's top/bottom/edge — move focus to the adjacent story row. */
    onArrowOut: (direction: "up" | "down" | "left" | "right", caretX: number | null) => void;
    onGoalColumnInvalidated: () => void;
    /** Backspace on an empty line: demote dialogue → narration, or delete the row and step back. */
    onBackspaceAtEmptyStart: () => void;
    /** Mod+Z / Mod+Shift+Z once the row's own history is spent — hand off to story history. */
    onUndoBeyondRow: () => void;
    onRedoBeyondRow: () => void;
    /** Activate a non-text row (Enter / double-click): opens its inspector in the right panel, or runs its card-less op. */
    onOpenInspector: () => void;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    tempSpeakers: TempSpeakerRef[];
    onSetSpeaker: (speaker: { characterId: string } | { speakerName: string } | null) => void;
    onCreateCharacter: (name: string) => void;
    onInsertAfter: () => void;
    /** Quick-delete this row from its hover actions. */
    onDeleteRow: () => void;
    /** Insert a fresh child (action / menu option) at the end of this container. */
    onAddInside: (parentId: StoryBlockId) => void;
    /** Append an if / else-if / else branch to a condition container. */
    onAddBranch: (conditionId: StoryBlockId, branch: "if" | "elseIf" | "else") => void;
    /** Run the live preview forward from this row (on an option row: enter that branch). */
    onPlayFromRow: (blockId: StoryBlockId) => void;
}) {
    const { t } = useTranslation();
    const { row, scene, document, characters, selected, active, collapsed, editing, textInputRef } = props;
    const block = row.block;
    const container = isContainerBlock(block);
    const containerInfo = container ? getContainerHeaderInfo(block) : null;
    const canFold = block.childrenIds.length > 0 && canAcceptChildren(block);
    const textSegment = getTextSegment(block);
    // Plain narration and studio notes hide their badge icon (but keep its slot, for alignment).
    const hideBadge = (block.kind === "nodeAction" && block.payload.action === "narration") || block.kind === "note";
    const isDialogue = block.kind === "nodeAction" && block.payload.action === "dialogue";
    // Dialogue-group continuation rows (WI-5): a later same-speaker dialogue, or a same-character
    // expression line folded into the run. Members drop their badge + nametag for a group rail.
    const dialogueMember = row.groupRole === "member" && isDialogue;
    const expressionMember = row.groupRole === "member"
        && block.kind === "action" && block.payload.action === "character" && block.payload.operation === "expression";
    // Every non-dialogue, non-narration/note row carries a low-key category colour bar at its left
    // edge, so scene / character / sound / flow rows read apart at a glance. Same single source as the
    // badge (ACTION_COMMAND_CATEGORIES via getBlockBadgeInfo); narration/note and in-group expression
    // members keep zero chrome.
    const categoryColor = !isDialogue && !hideBadge && row.groupRole !== "member" ? getBlockBadgeInfo(block).iconColor : null;
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
                selected ? "border-primary bg-primary/20" : active ? "border-primary bg-fill-subtle" : "border-transparent hover:bg-fill-subtle",
                // A disabled row (WI-3) dims whole — muted content, kept line number — but no invented
                // chrome; the runtime treats it as absent.
                row.disabled ? "opacity-45" : "",
            ].join(" ")}
            onClick={props.onSelect}
            onContextMenu={props.onContextMenu}
            onMouseDown={props.onMouseDown}
            onMouseEnter={props.onMouseEnter}
            onDoubleClick={event => {
                event.stopPropagation();
                // A row that holds text enters edit from the mouseup gesture, which carries the
                // author's selection in with it — a double-click there is that gesture's second
                // click and is already handled. Empty text rows and action rows have no selection to
                // preserve, so they still open from here.
                if ((event.target as HTMLElement | null)?.closest?.("[data-story-row-text]")) {
                    return;
                }
                textSegment ? props.onStartTextEdit() : props.onOpenInspector();
            }}
        >
            {block.kind === "action" && block.payload.action === "setBackground" ? (
                <BackgroundRowArtwork payload={block.payload} selected={selected} active={active} />
            ) : null}
            {categoryColor ? (
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-0.5"
                    style={{ backgroundColor: categoryColor, opacity: 0.55 }}
                />
            ) : null}
            <div className="relative flex h-full items-start justify-end pt-1 text-[12px] tabular-nums text-fg-subtle">
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
            <div className="relative flex self-stretch items-center justify-center">
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
                    ) : dialogueMember ? (
                        <GroupRail highlight={selected || active} />
                    ) : expressionMember ? null : hideBadge ? (
                        <span className="h-6 w-6 shrink-0" aria-hidden />
                    ) : (
                        <BlockBadge block={block} characters={characters} appearance={row.appearance} />
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
                    {expressionMember ? (
                        <GroupExpressionMember block={block} characters={characters} />
                    ) : editing && textSegment ? (
                        <TextEditBox
                            editorRef={textInputRef}
                            initialCaret={props.editInitialCaret}
                            onEditRichChange={props.onEditRichChange}
                            onCommitTextEdit={props.onCommitTextEdit}
                            onExitTextEdit={props.onExitTextEdit}
                            onContinue={props.onContinue}
                            onArrowOut={props.onArrowOut}
                            onGoalColumnInvalidated={props.onGoalColumnInvalidated}
                            onBackspaceAtEmptyStart={props.onBackspaceAtEmptyStart}
                            onUndoBeyondRow={props.onUndoBeyondRow}
                            onRedoBeyondRow={props.onRedoBeyondRow}
                            onInsertAfter={props.onInsertAfter}
                            block={block}
                            scene={scene}
                            tempSpeakers={props.tempSpeakers}
                            onSetSpeaker={props.onSetSpeaker}
                            onCreateCharacter={props.onCreateCharacter}
                            document={document}
                            characters={characters}
                            onSetDialogueCharacter={props.onSetDialogueCharacter}
                            hideSpeaker={dialogueMember}
                            suppressSpeakerColor={selected}
                        />
                    ) : textSegment || !containerInfo ? (
                        <BlockPreview
                            block={block}
                            scene={scene}
                            commandContext={props.commandContext}
                            tempSpeakers={props.tempSpeakers}
                            onSetSpeaker={props.onSetSpeaker}
                            onCreateCharacter={props.onCreateCharacter}
                            document={document}
                            characters={characters}
                            onSetDialogueCharacter={props.onSetDialogueCharacter}
                            hideSpeaker={dialogueMember}
                            suppressSpeakerColor={selected}
                            onUpdatePayload={props.onUpdatePayload}
                        />
                    ) : null}
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                        {containerInfo ? (
                            <ContainerHeaderAdd info={containerInfo} onAdd={() => props.onAddInside(block.id)} />
                        ) : (
                            <>
                                <StoryVoiceIndicator block={block} />
                                <RowActions onInsertAfter={props.onInsertAfter} onDelete={props.onDeleteRow} active={active} />
                            </>
                        )}
                        <RowPlayAction block={block} active={active} onPlay={() => props.onPlayFromRow(block.id)} />
                    </div>
                </div>
                {containerInfo ? (
                    <ContainerFooter
                        block={block}
                        info={containerInfo}
                        onAddInside={() => props.onAddInside(block.id)}
                        onAddBranch={branch => props.onAddBranch(block.id, branch)}
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
    initialCaret?: StoryCaretTarget;
    onEditRichChange: (value: string, runs: StoryRichRun[]) => void;
    onCommitTextEdit: () => void;
    onExitTextEdit: () => void;
    onContinue: () => void;
    onArrowOut: (direction: "up" | "down" | "left" | "right", caretX: number | null) => void;
    onGoalColumnInvalidated: () => void;
    onBackspaceAtEmptyStart: () => void;
    onUndoBeyondRow: () => void;
    onRedoBeyondRow: () => void;
    onInsertAfter: () => void;
    block: StoryBlock;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    tempSpeakers: TempSpeakerRef[];
    onSetSpeaker: (speaker: { characterId: string } | { speakerName: string } | null) => void;
    onCreateCharacter: (name: string) => void;
    /** In-group dialogue member (WI-5): drop the nametag and indent the text, matching the read row. */
    hideSpeaker?: boolean;
    /** Row is selected: the nametag yields its accent colour to the selection highlight. */
    suppressSpeakerColor?: boolean;
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
        <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <RichTextToolbar editor={props.editorRef} anchorRef={containerRef} commitGuard={commitGuardRef} active={activeMarks} hasVariables={variableOptions.scene.length + variableOptions.saved.length + variableOptions.persistent.length > 0} />
            {dialoguePayload && !props.hideSpeaker ? (
                <CharacterSelectTrigger
                    characters={props.characters}
                    tempSpeakers={props.tempSpeakers}
                    characterId={dialoguePayload.characterId}
                    speakerName={dialoguePayload.speakerName}
                    onChoose={props.onSetSpeaker}
                    onCreateCharacter={props.onCreateCharacter}
                    style={textStyle}
                    suppressColor={props.suppressSpeakerColor}
                />
            ) : null}
            <RichTextInput
                ref={props.editorRef}
                initialRuns={initialRuns}
                initialCaret={props.initialCaret}
                // Edit in place, VS Code style: no box, no sunken background, no horizontal padding — the
                // caret lands exactly where the read-only text sat. The active/selected row highlight is
                // the "you are here" signal, so the field needs none of its own. See the interaction model.
                // A group member indents by the same amount as its read row, so entering edit never jumps.
                className={["min-h-[20px] flex-1 whitespace-pre-wrap break-words bg-transparent text-fg outline-none empty:before:italic empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]", props.hideSpeaker ? GROUP_MEMBER_INDENT : ""].join(" ")}
                style={textStyle}
                placeholder={editorPlaceholder(props.block, t)}
                onChange={props.onEditRichChange}
                onBlur={handleBlur}
                onExit={props.onExitTextEdit}
                onEnter={props.onContinue}
                onShiftEnter={() => { props.onCommitTextEdit(); props.onInsertAfter(); }}
                onArrowOut={props.onArrowOut}
                onGoalColumnInvalidated={props.onGoalColumnInvalidated}
                onBackspaceAtEmptyStart={props.onBackspaceAtEmptyStart}
                onUndoBeyondRow={props.onUndoBeyondRow}
                onRedoBeyondRow={props.onRedoBeyondRow}
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

/**
 * Insert / Delete for a row.
 *
 * Shown on hover *and* on the active row: the editor is keyboard-first, and a control that only
 * exists under a pointer is a control a keyboard author never learns about. They stay `tabIndex={-1}`
 * on purpose — `Tab` indents the row (see the interaction model), so it is not a focus-traversal key
 * here and these must not swallow it. The keyboard path is the shortcut, which is why the shortcut is
 * on the `title`: that is the whole point of showing them on the active row.
 */
function RowActions(props: { onInsertAfter: () => void; onDelete: () => void; active: boolean }) {
    const { t } = useTranslation();
    // Rendered from the bindings themselves, never spelled out: `mod` is ⌘ or Ctrl depending on the
    // platform, and a hardcoded label is how a hint drifts from the key it claims to describe.
    const isMac = isMacPlatform();
    const insertKeys = formatKeybinding("shift+enter", isMac);
    const deleteKeys = formatKeybinding("delete", isMac);
    return (
        <div
            className={[
                "ml-auto flex shrink-0 items-center gap-1 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100",
                props.active ? "opacity-100" : "pointer-events-none opacity-0",
            ].join(" ")}
        >
            <button
                type="button"
                tabIndex={-1}
                title={t("story.rows.insertTitle", { keys: insertKeys })}
                className="rounded px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill hover:text-primary"
                onClick={event => {
                    event.stopPropagation();
                    props.onInsertAfter();
                }}
            >
                {t("story.rows.insert")}
            </button>
            <button
                type="button"
                tabIndex={-1}
                title={t("story.rows.deleteTitle", { keys: deleteKeys })}
                className="rounded px-1.5 py-1 text-2xs text-fg-muted hover:bg-danger/10 hover:text-danger"
                onClick={event => {
                    event.stopPropagation();
                    props.onDelete();
                }}
            >
                {t("story.rows.delete")}
            </button>
        </div>
    );
}

/**
 * "Play from here": hands this row to the live preview as a continuous playback start point.
 *
 * On a menu option or condition branch it is a *branch entry* — playback takes that road and keeps
 * going past the container, which is the one thing the state preview can't show you by selecting a
 * row. Those rows say so in words; ordinary rows keep the cluster quiet with an icon.
 */
function RowPlayAction(props: { block: StoryBlock; active: boolean; onPlay: () => void }) {
    const { t } = useTranslation();
    const { block } = props;
    // Rows with no runtime behaviour have no meaningful "play from here" — starting there would
    // silently begin somewhere else.
    if (block.kind === "note" || block.kind === "code" || block.kind === "invalid") {
        return null;
    }
    const branchEntry = (block.kind === "nodeAction" && block.payload.action === "choiceOption")
        || (block.kind === "control" && block.payload.control === "conditionBranch");
    const label = branchEntry ? t("story.rows.playBranch") : t("story.rows.playFromRow");
    return (
        <button
            type="button"
            tabIndex={-1}
            title={label}
            aria-label={label}
            className={[
                "flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-2xs text-fg-muted transition-opacity hover:bg-fill hover:text-primary group-hover:pointer-events-auto group-hover:opacity-100",
                props.active ? "opacity-100" : "pointer-events-none opacity-0",
            ].join(" ")}
            onClick={event => {
                event.stopPropagation();
                props.onPlay();
            }}
        >
            <Play className="h-3 w-3" />
            {branchEntry ? <span>{label}</span> : null}
        </button>
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

/** Left indent (Tailwind) applied to an in-group dialogue member's text so it reads under the speaker. */
const GROUP_MEMBER_INDENT = "pl-6";

/** The badge-slot rail an in-group dialogue member shows in place of its avatar (WI-5). */
function GroupRail({ highlight }: { highlight: boolean }) {
    return (
        <span className="relative h-6 w-6 shrink-0" aria-hidden>
            <span className={["absolute inset-y-0 left-[11px] w-px", highlight ? "bg-primary/40" : "bg-edge"].join(" ")} />
        </span>
    );
}

/**
 * The compact, muted body of an in-group expression row (WI-5): a small differential avatar and the
 * differential's name. It stays an ordinary row (selection / drag / Enter live on the row around it);
 * only the read-only content is compacted.
 */
function GroupExpressionMember({ block, characters }: { block: StoryBlock; characters: Character[] }) {
    const { t } = useTranslation();
    const { url: imageUrl, frame, showingSprite } = useCharacterBadgeImage(block, undefined, characters);
    const label = useMemo(() => {
        if (block.kind !== "action" || block.payload.action !== "character") {
            return "";
        }
        const parts: string[] = [];
        if (block.payload.formName) {
            parts.push(block.payload.formName);
        }
        const variants = block.payload.variants;
        if (Array.isArray(variants)) {
            parts.push(...variants);
        } else if (variants) {
            parts.push(...Object.values(variants));
        }
        return parts.join(" · ") || t("story.describe.charOp.expression");
    }, [block, t]);

    return (
        <span className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-2xs text-fg-subtle">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <span className="relative h-4 w-4 overflow-hidden rounded-full border border-edge bg-fill-subtle">
                    {imageUrl ? (
                        showingSprite ? (
                            <HeadThumbnail url={imageUrl} alt="" frame={frame} className="h-full w-full" iconClassName="h-2.5 w-2.5" />
                        ) : (
                            <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                        )
                    ) : null}
                </span>
            </span>
            <span className="min-w-0 truncate">{label}</span>
        </span>
    );
}

const CONTAINER_PILL_TONE: Record<StoryContainerHeaderInfo["role"], string> = {
    condition: "border-binding/40 bg-binding/10 text-binding",
    branch: "border-binding/40 bg-binding/10 text-binding",
    group: "border-success/40 bg-success/10 text-success",
    menu: "border-primary/40 bg-primary/10 text-primary",
    option: "border-primary/40 bg-primary/10 text-primary",
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
        | { kind: "expression"; expression: { source: string } }
        | undefined;
    if (!value) {
        return t("story.condition.summarySet");
    }
    if (value.kind === "blueprint") {
        return t("story.condition.summaryGraph");
    }
    if (value.kind === "expression") {
        return value.expression?.source || t("story.condition.summaryExpression");
    }
    const target = value.target;
    // v6: the variableId is a declaration row's id - read the name off the row itself.
    const declarationName = (variableId: string | undefined): string | null => {
        if (!variableId) return null;
        const inScene = scene.blocks[variableId];
        if (inScene?.kind === "declaration") return inScene.payload.name;
        for (const candidate of Object.values(document.scenes)) {
            const block = candidate.blocks[variableId];
            if (block?.kind === "declaration") return block.payload.name;
        }
        return null;
    };
    const name = target.scope === "persistent"
        ? t("story.condition.fallbackPersistent")
        : declarationName(target.variableId) ?? t("story.condition.fallbackVariable");
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
                className="min-w-0 max-w-[240px] truncate rounded border border-edge bg-fill-subtle px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-primary/50 hover:text-fg"
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
                className="w-14 rounded border border-edge bg-fill-subtle px-1.5 py-0.5 text-fg outline-none focus:border-primary/50"
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

/**
 * The icon for a candidate, chosen from what the param is asking for. A speaker with nobody behind it
 * gets the outline icon the picker uses, so picking one is never mistaken for picking a character.
 */
function candidateIcon(cursor: StoryCommandCursor, candidate: StoryCommandCandidate): { icon: typeof Hash; className?: string } | null {
    if (cursor.kind !== "positional" && cursor.kind !== "paramValue") {
        return null;
    }
    const [type] = paramTypes(cursor.param);
    switch (type?.kind) {
        case "asset":
            return { icon: type.assetType === "audio" ? Music : type.assetType === "video" ? Video : Image };
        case "character":
            return candidate.free ? { icon: UserRoundPlus } : { icon: Hash, className: "text-primary/80" };
        case "scene":
            return { icon: Route };
        case "variable":
            return { icon: Variable };
        default:
            return null;
    }
}

/**
 * The grey `<Var Name>` that trails the caret on a command line.
 *
 * Rendered as a mirror of the typed text — the text itself repeated but invisible, then the hint —
 * rather than by measuring the caret's pixel offset. Measuring would need a canvas metrics pass that
 * re-runs on every keystroke and still drifts on font fallback (a CJK variable name is the case that
 * breaks it); repeating the text lets the browser do the layout with the same font, in the same box,
 * and the hint lands exactly where the next character would.
 *
 * Consequently the mirror must match the textarea's own metrics exactly: same `textStyle`, same zero
 * padding, `whitespace-pre` so runs of spaces measure as typed, and `pointer-events-none` so a click
 * anywhere still lands in the field beneath.
 */
function CommandGhostHint(props: { value: string; source: string; caret: number; textStyle: CSSProperties; commandContext: StoryCommandContext }) {
    const { t } = useTranslation();
    // The ghost and reason parse the canonical "/" line (`source`); the invisible spacer below uses the
    // displayed `value` so it occupies the exact width the author sees ("@" and "/" render differently).
    const ghost = useMemo(() => getCommandGhost(props.source, props.caret), [props.caret, props.source]);
    // Why the line will not commit, if it will not. It outranks the hint: naming the next slot while
    // the line is already broken answers a question the author is no longer asking.
    const reason = useMemo(
        () => getCommandLineReason(props.source, props.commandContext),
        [props.commandContext, props.source],
    );
    if (!ghost && !reason) {
        return null;
    }
    return (
        <span
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre"
            style={props.textStyle}
        >
            {/* Invisible, not `opacity-0` on the whole span: only the copy of the typed text should be
                hidden, and it still has to occupy its exact width to push what follows into place. */}
            <span className="invisible">{props.value}</span>
            {reason ? (
                <span className="text-danger/80">{`  ${t(reason.key, reason.params)}`}</span>
            ) : (
                <span className="italic text-fg-subtle">{`<${t(`story.paramHint.${ghost!.hintKey}` as TranslationKey)}>`}</span>
            )}
        </span>
    );
}

export function InsertRow(props: {
    mode: Extract<EditorMode, { kind: "insert" }>;
    /** Nesting depth of where the new block will land, so the slot lines up under its future siblings. */
    depth?: number;
    characters: Character[];
    tempSpeakers: TempSpeakerRef[];
    /** What a name typed on this line may refer to — the same view the resolver reads. */
    commandContext: StoryCommandContext;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    onValueChange: (value: string) => void;
    onCommitNarration: (focusNext: boolean) => void;
    /** Escape #1 — drop the candidates, keep the line. */
    onDismissChooser: () => void;
    /** Escape #2 — an uncommitted slot leaves nothing behind. */
    onDiscardSlot: () => void;
    /** Enter / Shift+Enter with no candidate to take: the line stands on its own or becomes invalid. */
    onResolveLine: () => void;
    onCommitInvalid: () => void;
    onChooseCommand: (commandId: string) => void;
    onChooseCharacter: (characterId: string) => void;
    onChooseTempSpeaker: (name: string) => void;
    /** Backspace on the empty slot — dismiss it and step back to the row above. */
    onBackspaceEmpty: () => void;
    /** When on, a leading "@" opens the action creator like "/" (see `editor.slashAtAlias`). */
    slashAtAlias: boolean;
}) {
    const { t } = useTranslation();
    // The line the author sees keeps the trigger they typed; the parser, the cursor, and the command
    // search read the canonical "/" form (`source`). Same length, so `caret` indexes both.
    const source = useMemo(() => toCanonicalCommandLine(props.mode.value, props.slashAtAlias), [props.mode.value, props.slashAtAlias]);
    // Drop the trigger character (either "/" or "@") to get the query the menus rank against.
    const chooserQuery = props.mode.value.slice(1);
    const menuAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuPlacement = useAutoMenuPlacement(menuAnchorRef, props.mode.chooser !== "none", 312);
    const pluginCommands = useStoryPluginActionCommands();
    const actionOptions = useMemo<PaletteActionCommand[]>(
        () => searchActionCommands(
            [
                // The slash menu lists LINE commands (one per spec); plugin actions ride along as before.
                ...specPaletteCommands().map(command => localizeSpecCommand(command, t)),
                ...pluginCommands.map(command => localizeActionCommand(command, t)),
            ],
            chooserQuery,
        ),
        [chooserQuery, pluginCommands, t],
    );
    const characterOptions = useMemo(
        () => getSpeakerCandidates(props.characters, props.tempSpeakers, chooserQuery),
        [chooserQuery, props.characters, props.tempSpeakers],
    );
    const actionMenu = useActionCommandMenuState(actionOptions);
    const characterMenu = useCharacterPickerState(characterOptions);
    const textStyle = useStoryEditorTextStyle();

    // Where the caret is decides what the slot offers, so it has to be state: `/bg fo|` asks for an
    // image, `/bg forest_day t=|` for a transition, and only the caret tells them apart.
    const [caret, setCaret] = useState(props.mode.value.length);
    const cursor = useMemo(() => getCommandCursor(source, caret), [caret, source]);
    // `form=` can only list the forms of the character this line already named, so the candidates need
    // the args resolved so far.
    const resolvedArgs = useMemo(() => {
        const line = parseCommandLine(source);
        return line.kind === "command" && line.def ? resolveCommandLine(line, props.commandContext).args : {};
    }, [props.commandContext, source]);
    const argItems = useMemo<StoryCandidateItem[]>(() => {
        if (cursor.kind !== "positional" && cursor.kind !== "paramValue" && cursor.kind !== "paramName") {
            return [];
        }
        return getCommandCandidates(cursor, props.commandContext, resolvedArgs).map((candidate, index) => {
            const icon = candidateIcon(cursor, candidate);
            return {
                // Values are not unique on their own — two assets may share a name.
                key: `${index}:${candidate.value}`,
                value: candidate.value,
                label: candidate.label,
                detail: candidate.detail,
                icon: icon?.icon,
                iconClassName: icon?.className,
                tag: candidate.free ? t("story.rows.tempSpeaker") : undefined,
                ...(candidate.free ? { free: true as const } : {}),
            };
        });
    }, [cursor, props.commandContext, resolvedArgs, t]);
    // The candidates decide the highlight along with the cursor: an untyped slot and a slot whose best
    // offer is the author's own text both have to leave Enter meaning "submit". See `defaultHighlights`.
    const argMenu = useStoryCandidateMenuState(argItems, defaultHighlights(cursor, argItems));

    /**
     * The argument menu owns the slot whenever the caret is past the command name.
     *
     * An empty list still opens when the author typed something a param *could* have matched — that is
     * the "no matches" the speaker picker also shows. It stays shut for a param with nothing to
     * enumerate (a duration, a colour), where "no matches" would be nonsense, and at a `k=` position,
     * where an empty list means every param is already given and there is nothing left to say.
     */
    const argValuePosition = cursor.kind === "positional" || cursor.kind === "paramValue";
    const argMenuOpen = props.mode.chooser === "action"
        && (cursor.kind === "paramName" ? argItems.length > 0
            : argValuePosition && (argItems.length > 0 || (cursor.query.length > 0 && hasCandidateSource(cursor.param))));
    const actionMenuOpen = props.mode.chooser === "action" && cursor.kind === "commandName";

    /**
     * Replace the token under the caret and put the caret after what was written. The slot's value is
     * controlled, so the caret has to be restored by hand once React has rendered the new text.
     */
    const applyCompletion = (text: string, replace: { start: number; end: number }) => {
        const value = props.mode.value;
        const next = value.slice(0, replace.start) + text + value.slice(replace.end);
        const nextCaret = replace.start + text.length;
        props.onValueChange(next);
        setCaret(nextCaret);
        window.requestAnimationFrame(() => props.inputRef.current?.setSelectionRange(nextCaret, nextCaret));
    };

    const takeArgCandidate = (item: StoryCandidateItem) => {
        const completion = completionFor(cursor, item.value);
        if (completion) {
            applyCompletion(completion.text, completion.replace);
        }
    };

    /**
     * Taking a command from the menu completes the line rather than committing it — but only for a
     * command that has arguments to go on and fill. A command with no grammar has nothing more to say,
     * so it commits exactly as it does today; `/note` and `/imageCreate` keep their behaviour.
     */
    const chooseCommandCandidate = (commandId: string) => {
        const def = getCommandDef(commandId);
        if (def && def.params.length > 0) {
            // Rebuild the whole line, but keep the trigger the author is using so "@" does not flip to
            // "/" mid-completion. The commit path canonicalizes it either way.
            const trigger = actionTrigger(props.mode.value, props.slashAtAlias) ?? ACTION_TRIGGER;
            applyCompletion(`${trigger}${def.token} `, { start: 0, end: props.mode.value.length });
            return;
        }
        props.onChooseCommand(commandId);
    };

    return (
        // The open slot is the active line: it carries the same left-accent + fill the active/editing
        // rows use, so "you are creating a row here" reads at a glance (the rows drop their own
        // highlight while it is open — see the tab's `insertActive`). The marker attribute lets the
        // comfortable-density rule open it to the same 46px as a committed row, so narration's Enter
        // falls into it without a vertical jump.
        <div data-story-insert-slot="" className="relative grid min-h-[35px] grid-cols-[36px_28px_1fr] items-start border-l-2 border-primary bg-fill-subtle pr-3">
            <div aria-hidden />
            <div className="flex justify-center pt-1">
                <Plus className="h-4 w-4 text-primary" />
            </div>
            <div ref={menuAnchorRef} className="relative min-w-0 py-1">
                {/* Mirror a row's content column so the slot lines up with its future siblings: guide
                    rails + depth indent, then a badge-sized spacer before the field (rows reserve the
                    same 24px + gap, whether they show a badge or hide it). */}
                <RailGuides depth={props.depth ?? 0} highlight={false} />
                <div style={{ paddingLeft: (props.depth ?? 0) * RAIL_STEP }}>
                <div className="flex min-h-[27px] items-center gap-2">
                <span className="h-6 w-6 shrink-0" aria-hidden />
                {/* The ghost hint sits in a wrapper around the textarea rather than the row's own
                    anchor, so it is positioned against the field's box and inherits its exact metrics.
                    `min-w-0 flex-1` moves off the textarea onto the wrapper; the textarea then fills it. */}
                <div className="relative flex min-w-0 flex-1">
                <CommandGhostHint value={props.mode.value} source={source} caret={caret} textStyle={textStyle} commandContext={props.commandContext} />
                <textarea
                    ref={props.inputRef}
                    // Same in-place surface as an editing row (see TextEditBox): the new line reads as a
                    // line being typed, not a widget dropped into the list — which is what lets narration's
                    // Enter fall into this slot without the text visibly jumping.
                    className="relative min-h-[20px] w-full resize-none bg-transparent px-0 py-0 text-fg outline-none placeholder:italic placeholder:text-fg-subtle"
                    style={textStyle}
                    rows={1}
                    value={props.mode.value}
                    // The hint advertises whichever trigger this author actually uses.
                    placeholder={t("story.rows.insertPlaceholder", { trigger: props.slashAtAlias ? "@" : "/" })}
                    onChange={event => {
                        setCaret(event.target.selectionStart ?? event.target.value.length);
                        props.onValueChange(event.target.value);
                    }}
                    // Fires on caret moves as well as selections — the slot has to follow the caret,
                    // not just the text, or clicking back into `/bg |forest` would still offer transitions.
                    onSelect={event => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
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
                        // Escape is one ladder, one rung per press: candidates first, then the slot.
                        // It never commits anything — that was the old behaviour that turned a
                        // half-typed `/set` into a line of prose the author never wrote.
                        if (event.key === "Escape") {
                            event.preventDefault();
                            props.mode.chooser === "none" ? props.onDiscardSlot() : props.onDismissChooser();
                            return;
                        }
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            if (argMenuOpen) {
                                event.preventDefault();
                                argMenu.move(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                            if (actionMenuOpen) {
                                event.preventDefault();
                                actionMenu.moveCommand(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                            if (props.mode.chooser === "character") {
                                event.preventDefault();
                                characterMenu.moveCharacter(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                        }
                        // Tab and Enter both take the highlight. Keeping them identical here is the
                        // point: the highlight is the pointer, so whichever key the author reaches for
                        // does what the menu is showing. Tab no longer cycles categories.
                        const takeHighlighted = () => {
                            if (argMenuOpen) {
                                // No highlight is the answer at a `k=` position: Enter falls through and
                                // submits the line instead of grabbing `t=`.
                                if (!argMenu.activeItem) {
                                    return false;
                                }
                                takeArgCandidate(argMenu.activeItem);
                                return true;
                            }
                            if (actionMenuOpen) {
                                const command = actionMenu.activeCommand;
                                if (!command) {
                                    return false;
                                }
                                chooseCommandCandidate(command.id);
                                return true;
                            }
                            if (props.mode.chooser === "character") {
                                const candidate = characterMenu.activeCharacter;
                                if (!candidate) {
                                    return false;
                                }
                                candidate.kind === "character"
                                    ? props.onChooseCharacter(candidate.character.profile.getId())
                                    : props.onChooseTempSpeaker(candidate.name);
                                return true;
                            }
                            return false;
                        };
                        if (event.key === "Tab") {
                            event.preventDefault();
                            if (takeHighlighted()) {
                                return;
                            }
                            // Tab advances *within* the row. With nothing highlighted — a `k=` position,
                            // where Enter submits instead — it still takes the first candidate, which is
                            // what walks the caret on to the next argument.
                            if (argMenuOpen && argItems.length > 0) {
                                takeArgCandidate(argItems[0]);
                            }
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            // Shift+Enter always ends the line and opens a blank one. On a `#` line
                            // there is no dialogue to keep, so it lands as invalid rather than as a
                            // speaker with nothing to say.
                            if (event.shiftKey) {
                                props.mode.chooser === "character" ? props.onCommitInvalid() : props.onResolveLine();
                                return;
                            }
                            if (!takeHighlighted()) {
                                props.onResolveLine();
                            }
                        }
                    }}
                />
                </div>
                </div>
                </div>
                {actionMenuOpen ? (
                    <ActionCommandMenu
                        categories={actionMenu.visibleCategories}
                        activeCategoryId={actionMenu.activeCategoryId}
                        activeCommandId={actionMenu.activeCommand?.id ?? null}
                        onHighlightCommand={actionMenu.selectCommand}
                        onChoose={chooseCommandCandidate}
                        onCancel={props.onDismissChooser}
                        placement={menuPlacement}
                    />
                ) : null}
                {argMenuOpen ? (
                    <StoryCommandCandidateMenu
                        items={argItems}
                        activeKey={argMenu.activeItem?.key ?? null}
                        onHighlight={argMenu.selectItem}
                        onChoose={takeArgCandidate}
                        onCancel={props.onDismissChooser}
                        placement={menuPlacement}
                    />
                ) : null}
                {props.mode.chooser === "character" ? (
                    <CharacterPicker
                        characters={characterOptions}
                        activeCharacterId={characterMenu.activeCharacter?.key ?? null}
                        onHighlight={characterMenu.selectCharacter}
                        onChoose={candidate => candidate.kind === "character"
                            ? props.onChooseCharacter(candidate.character.profile.getId())
                            : props.onChooseTempSpeaker(candidate.name)}
                        onClear={props.onDismissChooser}
                        placement={menuPlacement}
                    />
                ) : null}
            </div>
        </div>
    );
}

/**
 * A speaker the picker can offer: a real Studio character, or a bare name (one already used
 * elsewhere in the story, or the one being typed right now).
 */
export type SpeakerCandidate =
    | { key: string; kind: "character"; name: string; character: Character }
    | { key: string; kind: "temp"; name: string };

/** Temp-speaker keys cannot collide with a character's UUID, which has no ':'. */
const tempSpeakerKey = (name: string) => `name:${name}`;

/**
 * Candidates for `#…`, ordered so the default highlight is the right answer: real characters first,
 * then names already used in this story, then — always — the name being typed.
 *
 * That last entry is why this list is never empty, and it is the whole trick: "nothing matched" stops
 * being a state with its own rules. An unknown name is just a candidate you pick like any other, so
 * Tab and Enter mean one thing here rather than two.
 */
export function getSpeakerCandidates(characters: Character[], tempSpeakers: TempSpeakerRef[], query: string): SpeakerCandidate[] {
    const typed = query.trim();
    const needle = typed.toLowerCase();
    const candidates: SpeakerCandidate[] = [];
    const seen = new Set<string>();

    for (const character of characters) {
        const name = character.profile.getName();
        if (needle && !name.toLowerCase().includes(needle)) {
            continue;
        }
        candidates.push({ key: character.profile.getId(), kind: "character", name, character });
        seen.add(name.toLowerCase());
    }
    for (const speaker of tempSpeakers) {
        if (needle && !speaker.name.toLowerCase().includes(needle)) {
            continue;
        }
        if (seen.has(speaker.name.toLowerCase())) {
            continue;
        }
        candidates.push({ key: tempSpeakerKey(speaker.name), kind: "temp", name: speaker.name });
        seen.add(speaker.name.toLowerCase());
    }
    if (typed && !seen.has(needle)) {
        candidates.push({ key: tempSpeakerKey(typed), kind: "temp", name: typed });
    }
    return candidates;
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
        moveCommand,
    };
}

function ActionCommandMenu(props: {
    categories: VisibleActionCommandCategory[];
    activeCategoryId: ActionCommandCategoryId;
    activeCommandId: string | null;
    onHighlightCommand: (commandId: string) => void;
    onChoose: (commandId: string) => void;
    onCancel: () => void;
    placement: PopupPlacement;
}) {
    const { t } = useTranslation();
    const activeCategory = props.categories.find(category => category.id === props.activeCategoryId) ?? props.categories[0] ?? null;
    const listRef = useRef<HTMLDivElement | null>(null);

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
            className={["absolute left-0 z-50 w-[420px] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
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
                    <div ref={listRef} className="nl-no-scrollbar max-h-64 overflow-auto p-1">
                        {activeCategory && activeCategory.commands.length === 0 ? (
                            <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onCancel}>
                                {t("story.actionCreator.noActions")}
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
                                        active ? "bg-primary/15 text-fg" : "hover:bg-fill",
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
            )}
        </div>
    );
}

function useCharacterPickerState(candidates: SpeakerCandidate[]) {
    const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
    const activeCharacter = candidates.find(candidate => candidate.key === activeCharacterId) ?? candidates[0] ?? null;

    useEffect(() => {
        if (candidates.length === 0) {
            setActiveCharacterId(null);
            return;
        }
        setActiveCharacterId(current => candidates.some(candidate => candidate.key === current) ? current : candidates[0].key);
    }, [candidates]);

    const selectCharacter = (characterId: string) => {
        setActiveCharacterId(characterId);
    };

    const moveCharacter = (direction: -1 | 1) => {
        if (candidates.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, candidates.findIndex(candidate => candidate.key === activeCharacter?.key));
        const nextIndex = (currentIndex + direction + candidates.length) % candidates.length;
        setActiveCharacterId(candidates[nextIndex].key);
    };

    return {
        activeCharacter,
        selectCharacter,
        moveCharacter,
    };
}

function CharacterPicker(props: {
    characters: SpeakerCandidate[];
    activeCharacterId: string | null;
    onHighlight: (candidateKey: string) => void;
    onChoose: (candidate: SpeakerCandidate) => void;
    onClear: () => void;
    placement: PopupPlacement;
    /** Rendered as a trailing action when the typed name is not already a character. */
    createLabel?: string | null;
    onCreate?: () => void;
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
            className={["absolute left-0 z-50 max-h-72 w-[320px] overflow-auto rounded-xl border border-edge bg-surface-raised p-1 shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
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
                props.characters.map(candidate => {
                    const active = candidate.key === props.activeCharacterId;
                    const temp = candidate.kind === "temp";
                    return (
                        <button
                            key={candidate.key}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-character-id={candidate.key}
                            className={[
                                "flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors",
                                active ? "bg-primary/15 text-fg" : "hover:bg-fill",
                            ].join(" ")}
                            onMouseEnter={() => props.onHighlight(candidate.key)}
                            onMouseDown={() => props.onChoose(candidate)}
                        >
                            {/* A temp speaker is a name with nobody behind it — it gets the outline icon
                                and a tag, so picking one is never mistaken for picking a real character. */}
                            {temp
                                ? <UserRoundPlus className={["h-4 w-4 shrink-0", active ? "text-fg-muted" : "text-fg-subtle"].join(" ")} />
                                : <Hash className={["h-4 w-4 shrink-0", active ? "text-primary" : "text-primary/80"].join(" ")} />}
                            <span className="truncate text-sm text-fg">{candidate.name}</span>
                            {temp ? <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{t("story.rows.tempSpeaker")}</span> : null}
                        </button>
                    );
                })
            )}
            {props.createLabel ? (
                <>
                    <div className="my-1 h-px bg-edge" />
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-fill"
                        onMouseDown={props.onCreate}
                    >
                        <UserRoundPlus className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm text-fg">{props.createLabel}</span>
                    </button>
                </>
            ) : null}
        </div>
    );
}

/**
 * The speaker nametag on a dialogue row: a text field, not a menu.
 *
 * Clicking it puts the caret in the name with the same candidate list the `#` slot uses, which is what
 * gives a temp speaker a way to be renamed — there is no character record to go and edit, so the
 * nametag itself has to be the place you edit it. Committing a name that matches nothing keeps it as a
 * temp speaker; "Create character" turns it into a real one.
 */
function CharacterSelectTrigger(props: {
    characters: Character[];
    tempSpeakers: TempSpeakerRef[];
    characterId: string | undefined;
    speakerName: string | undefined;
    onChoose: (speaker: { characterId: string } | { speakerName: string } | null) => void;
    onCreateCharacter: (name: string) => void;
    className?: string;
    style?: CSSProperties;
    /** When the row is selected, drop the accent so the selection highlight owns the nametag colour. */
    suppressColor?: boolean;
}) {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const placement = useAutoMenuPlacement(rootRef, editing, 288);

    const committedName = props.characterId
        ? getCharacterName(props.characters, props.characterId)
        : props.speakerName ?? "";
    // A real character (not a bare temp speaker) may carry an editor accent colour for its nametag —
    // but a selected row yields it to the selection highlight (the "you are here" signal wins).
    const characterColor = props.characterId && !props.speakerName && !props.suppressColor
        ? getCharacterColor(props.characters, props.characterId)
        : undefined;
    const candidates = useMemo(
        () => getSpeakerCandidates(props.characters, props.tempSpeakers, draft),
        [draft, props.characters, props.tempSpeakers],
    );
    const picker = useCharacterPickerState(candidates);
    const trimmed = draft.trim();
    // Only worth offering when the name is genuinely new — otherwise it is a duplicate of a candidate.
    const canCreate = Boolean(trimmed) && !candidates.some(candidate => candidate.kind === "character" && candidate.name.toLowerCase() === trimmed.toLowerCase());

    const close = () => {
        setEditing(false);
        setDraft("");
    };

    const beginEditing = () => {
        setDraft(committedName);
        setEditing(true);
        window.requestAnimationFrame(() => inputRef.current?.select());
    };

    const choose = (candidate: SpeakerCandidate) => {
        props.onChoose(candidate.kind === "character"
            ? { characterId: candidate.character.profile.getId() }
            : { speakerName: candidate.name });
        close();
    };

    /** Enter with nothing highlighted still has to mean something: keep whatever was typed. */
    const commitDraft = () => {
        const highlighted = picker.activeCharacter;
        if (highlighted) {
            choose(highlighted);
            return;
        }
        props.onChoose(trimmed ? { speakerName: trimmed } : null);
        close();
    };

    useEffect(() => {
        if (!editing) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                close();
            }
        };
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [editing]);

    if (!editing) {
        const unassigned = !committedName;
        return (
            <div ref={rootRef} className="relative shrink-0 overflow-visible">
                <button
                    type="button"
                    className={[
                        "flex h-full min-h-[28px] max-w-full items-center truncate rounded px-1 py-0.5 text-left text-sm hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                        unassigned ? "italic text-fg-subtle hover:text-primary" : props.speakerName ? "text-fg-muted" : characterColor ? "" : "text-primary",
                        props.className ?? "",
                    ].join(" ")}
                    style={characterColor ? { ...props.style, color: characterColor } : props.style}
                    onMouseDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={event => {
                        event.stopPropagation();
                        beginEditing();
                    }}
                >
                    <span className="truncate">{unassigned ? getCharacterName(props.characters, undefined) : committedName}</span>
                </button>
            </div>
        );
    }

    return (
        <div ref={rootRef} className="relative shrink-0 overflow-visible">
            <input
                ref={inputRef}
                value={draft}
                className={[
                    "h-full min-h-[28px] w-[128px] rounded border border-primary/50 bg-surface-sunken px-1 py-0.5 text-sm text-fg outline-none",
                    props.className ?? "",
                ].join(" ")}
                style={props.style}
                onChange={event => setDraft(event.target.value)}
                onMouseDown={event => event.stopPropagation()}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        picker.moveCharacter(event.key === "ArrowDown" ? 1 : -1);
                        return;
                    }
                    // Same contract as the `#` slot: the highlight is what Tab and Enter both take.
                    if (event.key === "Tab" || event.key === "Enter") {
                        event.preventDefault();
                        commitDraft();
                        return;
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        close();
                    }
                }}
            />
            <CharacterPicker
                characters={candidates}
                activeCharacterId={picker.activeCharacter?.key ?? null}
                onHighlight={picker.selectCharacter}
                onChoose={choose}
                onClear={() => {
                    props.onChoose(null);
                    close();
                }}
                placement={placement}
                createLabel={canCreate ? t("story.rows.createCharacter", { name: trimmed }) : null}
                onCreate={() => {
                    props.onCreateCharacter(trimmed);
                    close();
                }}
            />
        </div>
    );
}

/**
 * Which character and appearance a row's badge should picture, and whether to resolve a
 * differential-specific sprite (vs. fall straight through to the profile thumbnail).
 *
 * A character action row (`/show`, `/face`…) pictures its own payload's form/variants. A dialogue row
 * pictures the speaker's accumulated appearance (WI-3) — but only when one exists; a speaker who has
 * not been shown keeps the plain thumbnail, so a line before any `/show` does not invent a look.
 */
function getBadgeImageSpec(
    block: StoryBlock,
    appearance: CharacterAppearanceRef | undefined,
): { characterId: string; formName?: string; variants?: StoryCharacterVariantSelection; resolveVariant: boolean } | null {
    if (block.kind === "action" && block.payload.action === "character" && block.payload.characterId) {
        return { characterId: block.payload.characterId, formName: block.payload.formName, variants: block.payload.variants, resolveVariant: true };
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.characterId) {
        return { characterId: block.payload.characterId, formName: appearance?.formName, variants: appearance?.variants, resolveVariant: appearance !== undefined };
    }
    return null;
}

/**
 * The sprite `Asset` + portrait frame for a character's form/variants, resolved against the exact
 * selection rule the runtime uses (shared `selectCharacterVariantNames` / `resolveVariantEntry`). The
 * frame is the form's own portrait override, else the profile default; `undefined` lets the badge fall
 * back to the automatic head crop. The `Asset` object (not just its id) is returned because a
 * differential sprite is a *project* asset and loads through the asset library, not the editor store.
 */
function resolveCharacterBadgeImage(
    character: Character,
    formName: string | undefined,
    variants: StoryCharacterVariantSelection | undefined,
): { asset: Asset<AssetType.Image> | null; frame?: NormalizedCrop } {
    const forms = character.profile.appearance.getForms();
    const form = forms.find(candidate => candidate.name === formName)
        ?? forms.find(candidate => candidate.name === character.profile.getDefaultForm())
        ?? forms[0];
    if (!form) {
        return { asset: null };
    }
    const variantNames = selectCharacterVariantNames(form, variants);
    const entry = resolveVariantEntry(form.variantAssets, variantNames, candidate => Boolean(candidate.data?.id));
    return { asset: entry?.data ?? null, frame: form.portrait ?? character.profile.getPortrait() };
}

/**
 * The framed avatar a character row should picture: the differential sprite when a look applies
 * (loaded from the project asset library, framed on the face), else the character thumbnail (an editor
 * asset, already a square crop). Both share the id-keyed object-URL cache so one sprite is read — and
 * its head located — once no matter how many rows show it.
 */
function useCharacterBadgeImage(
    block: StoryBlock,
    appearance: CharacterAppearanceRef | undefined,
    characters: Character[],
): { url: string | null; frame?: NormalizedCrop; showingSprite: boolean } {
    const spec = getBadgeImageSpec(block, appearance);
    const character = spec ? characters.find(next => next.profile.getId() === spec.characterId) : undefined;
    const resolved = character && spec?.resolveVariant
        ? resolveCharacterBadgeImage(character, spec.formName, spec.variants)
        : { asset: null as Asset<AssetType.Image> | null, frame: undefined };
    const thumbnailId = character?.profile.getThumbnail() ?? null;
    const source: BadgeImageSource | null = resolved.asset
        ? { kind: "project", asset: resolved.asset }
        : thumbnailId
            ? { kind: "editor", fileId: thumbnailId }
            : null;
    const url = useBadgeImageUrl(source);
    return { url, frame: resolved.frame, showingSprite: resolved.asset !== null };
}

function BlockBadge({ block, characters, appearance }: { block: StoryBlock; characters: Character[]; appearance?: CharacterAppearanceRef }) {
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);
    // A differential-resolved sprite (framed on the face) when a look applies; otherwise the profile
    // thumbnail (already a square crop, shown as-is); otherwise the category icon.
    const { url: imageUrl, frame, showingSprite } = useCharacterBadgeImage(block, appearance, characters);

    return (
        <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded border border-edge bg-fill-subtle" title={label} aria-label={label}>
            {imageUrl ? (
                showingSprite ? (
                    <HeadThumbnail url={imageUrl} alt="" frame={frame} className="h-full w-full" iconClassName="h-3.5 w-3.5" />
                ) : (
                    <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                )
            ) : (
                <>
                    {/* Badge fill carries the category colour (dimmed), so the icon reads on its own tint. */}
                    <span aria-hidden className="absolute inset-0" style={{ backgroundColor: iconColor, opacity: 0.14 }} />
                    <Icon className="relative h-3.5 w-3.5" style={{ color: iconColor }} />
                </>
            )}
        </span>
    );
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

/**
 * A text row's read-only body, sized as a click-to-edit surface (filled *and* empty rows — an empty
 * one just opens with the caret clamped to 0). It fills the row's height (`self-stretch`) and its
 * remaining width (`flex-1`) while keeping the glyphs vertically centred, so a click anywhere on the
 * line — the blank tail, or the strip above/below the text — lands the caret in the text rather than
 * selecting the row. `data-story-row-text` + `nl-selectable-text` are what let the mouseup gesture read
 * the click's unit offset out of it (see `finishTextSelectGesture`). Runs stay inside an inline
 * `RichTextView` child so multi-run rich text still wraps normally.
 */
function TextClickTarget(props: { style?: CSSProperties; className?: string; children: ReactNode }) {
    return (
        <div
            className={["flex min-w-0 flex-1 cursor-text items-center self-stretch nl-selectable-text", props.className].filter(Boolean).join(" ")}
            style={props.style}
            data-story-row-text=""
        >
            {props.children}
        </div>
    );
}

/** A draft row's line: the source, and why it has not committed yet. */
function DraftRowPreview(props: { source: string; commandContext: StoryCommandContext }) {
    const { t } = useTranslation();
    const reason = useMemo(
        () => getCommandLineDraftReason(props.source, props.commandContext),
        [props.commandContext, props.source],
    );
    const reasonText = reason
        ? t(reason.key, reason.paramHintKey ? { ...reason.params, slot: t(reason.paramHintKey) } : reason.params)
        : t("story.rows.invalidHint");
    return (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="min-w-0 truncate font-mono text-sm text-warning">{props.source}</span>
            <span className="shrink-0 truncate text-2xs text-warning/80">{reasonText}</span>
        </span>
    );
}

function BlockPreview(props: {
    block: StoryBlock;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    commandContext: StoryCommandContext;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    tempSpeakers: TempSpeakerRef[];
    onSetSpeaker: (speaker: { characterId: string } | { speakerName: string } | null) => void;
    onCreateCharacter: (name: string) => void;
    /** In-group dialogue member (WI-5): drop the nametag and indent the text under the group speaker. */
    hideSpeaker?: boolean;
    /** Row is selected: the nametag yields its accent colour to the selection highlight. */
    suppressSpeakerColor?: boolean;
    /** Commit an inline quick-param edit (WI-2) through the same history path the inspector uses. */
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    const block = props.block;
    const text = getTextSegment(block);
    const textStyle = useStoryEditorTextStyle();
    const quickParams = getQuickParams(block);
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        const hasValue = Boolean(text?.value) || Boolean(text?.rich && text.rich.length > 0);
        const memberIndent = props.hideSpeaker ? GROUP_MEMBER_INDENT : undefined;
        return (
            <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-sm">
                {props.hideSpeaker ? null : (
                    <CharacterSelectTrigger
                        characters={props.characters}
                        tempSpeakers={props.tempSpeakers}
                        characterId={block.payload.characterId}
                        speakerName={block.payload.speakerName}
                        onChoose={props.onSetSpeaker}
                        onCreateCharacter={props.onCreateCharacter}
                        style={textStyle}
                        suppressColor={props.suppressSpeakerColor}
                    />
                )}
                {hasValue && text ? (
                    <TextClickTarget style={textStyle} className={memberIndent}>
                        <RichTextView className="min-w-0 flex-1 whitespace-pre-wrap break-words text-fg" segment={text} document={props.document} sceneId={props.scene.id} />
                    </TextClickTarget>
                ) : (
                    <TextClickTarget style={textStyle} className={["italic text-fg-subtle", memberIndent].filter(Boolean).join(" ")}>{getEmptyTextPlaceholder(block)}</TextClickTarget>
                )}
            </div>
        );
    }
    if (text) {
        const hasValue = Boolean(text.value) || Boolean(text.rich && text.rich.length > 0);
        const note = block.kind === "note";
        if (!hasValue) {
            // Empty rows are click-to-edit too: the caret clamps to 0 in the empty editor, so the
            // placeholder's own offset never matters — a single click just opens the line.
            return (
                <TextClickTarget style={textStyle} className={note ? "italic text-fg-muted" : "italic text-fg-subtle"}>
                    {getEmptyTextPlaceholder(block)}
                </TextClickTarget>
            );
        }
        return (
            <TextClickTarget style={textStyle} className={note ? "italic text-fg-muted" : "text-fg"}>
                <RichTextView className="min-w-0 flex-1 whitespace-pre-wrap break-words" segment={text} document={props.document} sceneId={props.scene.id} />
            </TextClickTarget>
        );
    }
    if (block.kind === "action" && block.payload.action === "setBackground") {
        return <BackgroundBlockPreview payload={block.payload} quickParams={quickParams} onUpdatePayload={props.onUpdatePayload} />;
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
    if (block.kind === "invalid") {
        // A draft, not garbage: the author's text verbatim (monospace: it was a command), amber
        // rather than error-red - the muted fallback below would render it as a de-emphasized note,
        // which is the one thing it must never look like. The reason line says what is missing or
        // wrong, so the row reads as a to-do; the BUILD is where it turns into an error. Click
        // re-opens the line in place, candidates and all.
        return <DraftRowPreview source={block.payload.source} commandContext={props.commandContext} />;
    }
    if (quickParams.length > 0) {
        return (
            <QuickParamsSummary
                block={block}
                characters={props.characters}
                scene={props.scene}
                scenes={props.document.scenes}
                params={quickParams}
                textStyle={textStyle}
                onUpdatePayload={props.onUpdatePayload}
            />
        );
    }
    return <span className="min-w-0 flex-1 truncate text-sm text-fg-muted" style={textStyle}>{describeBlock(block, props.characters, props.scene, props.document.scenes)}</span>;
}

/**
 * Share of the row width covered by the scrim that keeps the gutter, grip and label legible on top
 * of the artwork. Fixed rather than label-driven so the seam lands in the same place down the list;
 * `BACKGROUND_LABEL_MAX_WIDTH` truncates the label before it can reach the fade.
 */
const BACKGROUND_SCRIM_WIDTH = "56%";
/** Softens the scrim's inner edge so it dissolves into the artwork instead of cutting a hard seam. */
const BACKGROUND_SCRIM_MASK = "linear-gradient(to right, #000 68%, transparent)";
/**
 * The label's own cap, measured against the content column: the scrim's share of the row, less the
 * gutter + grip + badge that sit ahead of the label. Kept a touch tighter than the fade's start so
 * truncation always wins before the text hits thinning scrim.
 */
const BACKGROUND_LABEL_MAX_WIDTH = "calc(56% - 84px)";

/**
 * The picked background, painted across the whole row — gutter and drag grip included — with a
 * translucent blurred panel holding the left side down so the text keeps its contrast. Rendered only
 * for background rows with the inspector closed (its card carries its own picker), which also keeps
 * the asset-url hook off every other row in the list.
 *
 * `bg-surface/75` rather than a literal black: on the dark theme it resolves to #0f1115 at 75%, but
 * a fixed black would leave the light theme's near-black `fg` unreadable on top of it.
 */
function BackgroundRowArtwork({ payload, selected, active }: {
    payload: Extract<StoryActionPayload, { action: "setBackground" }>;
    selected: boolean;
    active: boolean;
}) {
    const { url } = useAssetObjectUrl(payload.assetId ?? null);
    const color = !payload.assetId && payload.color ? payload.color : null;
    if (!url && !color) {
        return null;
    }
    return (
        <span className="pointer-events-none absolute inset-0 select-none overflow-hidden" aria-hidden>
            {url ? (
                <img src={url} alt="" draggable={false} className="h-full w-full object-cover object-center" />
            ) : (
                <span className="block h-full w-full" style={{ backgroundColor: color ?? undefined }} />
            )}
            <span
                className="absolute inset-y-0 left-0 bg-surface/75 backdrop-blur-[3px]"
                style={{
                    width: BACKGROUND_SCRIM_WIDTH,
                    maskImage: BACKGROUND_SCRIM_MASK,
                    WebkitMaskImage: BACKGROUND_SCRIM_MASK,
                }}
            />
            {selected ? (
                <span className="absolute inset-0 bg-primary/25" />
            ) : active ? (
                <span className="absolute inset-0 bg-fill-subtle" />
            ) : null}
        </span>
    );
}

function BackgroundBlockPreview({ payload, quickParams, onUpdatePayload }: {
    payload: Extract<StoryActionPayload, { action: "setBackground" }>;
    quickParams: QuickParam[];
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const textStyle = useStoryEditorTextStyle();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const asset = payload.assetId ? assetsService?.getAssets()[AssetType.Image]?.[payload.assetId] ?? null : null;
    const label = asset?.name ?? (payload.assetId ? t("story.background.missingImage") : payload.color || t("story.background.unassigned"));

    return (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-fg-muted" style={textStyle}>
            <span className="min-w-0 truncate" style={{ maxWidth: BACKGROUND_LABEL_MAX_WIDTH }}>
                {t("story.rows.setBackground")} <span className={payload.assetId || payload.color ? "text-fg" : "italic text-fg-subtle"}>{label}</span>
            </span>
            <QuickParamsInline params={quickParams} onUpdatePayload={onUpdatePayload} />
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
