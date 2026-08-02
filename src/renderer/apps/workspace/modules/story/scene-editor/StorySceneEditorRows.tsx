import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClipboardEvent, CSSProperties, ReactNode, RefObject, MouseEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronRight, GanttChart, GripVertical, Hash, Image, LayoutGrid, List, Music, Play, Plus, Route, Trash2, TriangleAlert, UserRoundPlus, Variable, Video } from "lucide-react";
import type { TempSpeakerRef } from "@/lib/workspace/services/story/storyModel";
import { useSortable } from "@dnd-kit/sortable";
import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryCharacterTagSelection, StoryDocument, StoryRichRun, StoryScene, StorySceneId } from "@shared/types/story";
import { representativeAssetId } from "@shared/utils/characterVariant";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { useCompositedSprite } from "@/lib/workspace/hooks/useCompositedSprite";
import type { NormalizedCrop } from "@/lib/utils/headCrop";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { isRowTextEditable } from "./storySceneReadOnly";
import { useCommandTranslation, useTranslation } from "@/lib/i18n";
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
import type { PaletteActionCommand } from "./storyActionCommands";
import {
    commandCategoryLabelKey,
    getCommandCategory,
    getCommandGroup,
    STORY_COMMAND_CATEGORIES,
    subjectGroupId,
    type StoryCommandCategoryId,
} from "./storyCommandCategories";
import { searchActionCommands } from "./storyCommandSearch";
import { localizeSpecCommand, specPaletteCommands } from "./commands/specPalette";
import { browseMenuStops, buildSpecSidebarGroups, dedupeToPrimarySubject, filterSidebarGroups, type StoryCommandMenuStop, type StoryCommandSidebarGroup } from "./commands/specSidebar";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { paramTypes } from "./storyCommandGrammar";
import { getCommandDef, localizedCommandToken } from "./commands/registry";
import { localizeCommandVerb } from "./storyCommandSpelling";
import { completionFor, defaultHighlights, getCommandCursor, type StoryCommandCursor } from "./storyCommandCursor";
import { getCommandCandidates, hasCandidateSource, type StoryCommandCandidate } from "./storyCommandCandidates";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";
import { StoryCommandCandidateMenu, useStoryCandidateMenuState, type StoryCandidateItem } from "./StoryCommandCandidateMenu";
import { RichTextInput, type ActiveMarks, type EventClickInfo, type InterpolationClickInfo, type PauseClickInfo, type RichTextInputHandle } from "./RichTextInput";
import { RichTextToolbar } from "./RichTextToolbar";
import type { RichTextToolbarHandle } from "./RichTextToolbar";
import { InterpolationPopover } from "./InterpolationPopover";
import { ExpressionPopover } from "./ExpressionPopover";
import { collectStoryVariableOptions, resolveInterpolationName, type PersistentVariableOption } from "./storyInterpolation";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { RichTextView } from "./RichTextView";
import { StoryVoiceIndicator } from "./StoryVoiceIndicator";
import { PausePopover } from "./PausePopover";
import { segmentToRuns } from "./richText";
import { STORY_DENSITY_METRICS, useStoryEditorTextStyle } from "./storyEditorTextStyle";
import type { StoryEditorDensity } from "./storyEditorSessionStore";
import type { CharacterAppearanceRef, EditorMode, StoryCaretTarget, StoryStagePlacement, VisibleStoryRow } from "./storySceneEditorTypes";
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
import { BlockOverview } from "./storyQuickParams";
import { actionTrigger, ACTION_TRIGGER, insertChooserType, isActionCommandLine, toCanonicalCommandLine } from "./commandTrigger";
import { StoryCommandLineText } from "./StoryCommandLineView";
import { useStoryRowActions } from "./storyRowActions";
import { diagnoseRow, type StoryRowDiagnosticCode } from "./storyRowDiagnostics";
import { useReduceMotion } from "@/lib/appearance/useReduceMotion";

/**
 * One story row.
 *
 * Memoised, and the props above are why it can be: they are data. Everything the row can *do* comes
 * from `StoryRowActionsContext` as one object that never changes identity, so a state change hands
 * each row the same props it had and only the rows whose data actually moved re-render. Before that
 * split, the tab built ~25 arrow functions per row inside its `map`, which made every render a full
 * re-render of the document — 100ms per keystroke on a 400-row scene, growing with the scene.
 *
 * Closures built *inside* this function (see `on` below) are free: memo compares props, not internals.
 */
export const StoryBlockRow = memo(function StoryBlockRow(props: {
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
    tempSpeakers: TempSpeakerRef[];
    /**
     * Reading density (U1). The row itself reads nothing from it any more — every length it needs
     * arrives as a CSS variable on the editor root — but it stays a prop so a density switch still
     * crosses the memo boundary and re-renders the rows at the new metrics.
     */
    density: StoryEditorDensity;
}) {
    const { t } = useTranslation();
    const { row, scene, document, characters, selected, active, collapsed, editing, textInputRef } = props;
    // The name column carries the editor's body type, so the nametag and the words it introduces are
    // the same size — the column, not a smaller type, is what makes the name read as a label.
    const textStyle = useStoryEditorTextStyle();
    const actions = useStoryRowActions();
    const blockId = row.block.id;
    /**
     * This row's half of every action, bound to its id. Rebuilt each render on purpose — these are
     * internals, not props, so they cost nothing at the memo boundary, and pinning them with
     * `useCallback` would buy 26 dependency arrays to maintain for no gain.
     */
    const on = {
        onSelect: (event: MouseEvent) => actions.select(blockId, event),
        onContextMenu: (event: MouseEvent) => actions.contextMenu(blockId, event),
        onMouseDown: (event: MouseEvent) => actions.mouseDown(blockId, event),
        onMouseEnter: () => actions.mouseEnter(blockId),
        onToggleCollapsed: () => actions.toggleCollapsed(blockId),
        onStartTextEdit: () => actions.startTextEdit(blockId),
        onEditRichChange: (value: string, runs: StoryRichRun[]) => actions.editRichChange(blockId, value, runs),
        onMultiLinePaste: (event: ClipboardEvent<HTMLDivElement>) => actions.pasteIntoRowText(blockId, event),
        onCommitTextEdit: actions.commitTextEdit,
        onExitTextEdit: actions.exitTextEdit,
        onContinue: actions.continueRow,
        onArrowOut: actions.arrowOut,
        onGoalColumnInvalidated: actions.goalColumnInvalidated,
        onBackspaceAtEmptyStart: actions.backspaceAtEmptyStart,
        onUndoBeyondRow: actions.undoBeyondRow,
        onRedoBeyondRow: actions.redoBeyondRow,
        onOpenInspector: () => actions.openInspector(blockId),
        onRevealInspectorPanel: actions.revealInspectorPanel,
        onUpdatePayload: (payload: StoryBlock["payload"]) => actions.updatePayload(blockId, payload),
        onSetDialogueCharacter: (characterId: string | undefined) => actions.setDialogueCharacter(blockId, characterId),
        // The placement source is the row's own resolved appearance, which only the row knows.
        onSetPosition: (position: StoryStagePlacement) => actions.setPosition(blockId, position, row.appearance?.positionSourceId ?? null),
        onSetSpeaker: (speaker: { characterId: string } | { speakerName: string } | null) => actions.setSpeaker(blockId, speaker),
        onCreateCharacter: (name: string) => actions.createCharacter(blockId, name),
        onInsertAfter: () => actions.insertAfter(blockId),
        onDeleteRow: () => actions.deleteRow(blockId),
        onAddInside: actions.addInside,
        onAddBranch: actions.addBranch,
        onPlayFromRow: actions.playFromRow,
    };

    const block = row.block;
    const container = isContainerBlock(block);
    const containerInfo = container ? getContainerHeaderInfo(block) : null;
    const lensMode: "all" | "allAsync" | "any" | null = block.kind === "control" && block.payload.control === "race"
        ? "any"
        : block.kind === "control" && block.payload.control === "parallel"
            ? (block.payload.mode === "allAsync" ? "allAsync" : "all")
            : null;
    const canFold = block.childrenIds.length > 0 && canAcceptChildren(block);
    const textSegment = getTextSegment(block);
    // Plain narration and studio notes hide their badge icon (but keep its slot, for alignment).
    const hideBadge = (block.kind === "nodeAction" && block.payload.action === "narration") || block.kind === "note";
    const isDialogue = block.kind === "nodeAction" && block.payload.action === "dialogue";
    // Dialogue-group continuation rows (WI-5): a later same-speaker dialogue, or a same-character
    // expression line folded into the run. Members drop their badge + nametag for a group rail.
    const dialogueMember = row.groupRole === "member" && isDialogue;
    // A dialogue group head backed by a real character carries the hover-reveal placement dropdown
    // (WI-3): a standalone line is a run of one, so it counts too. A bare-name speaker has no character
    // to place, so it gets none.
    const dialogueHead = isDialogue && row.groupRole !== "member"
        && block.kind === "nodeAction" && block.payload.action === "dialogue" && Boolean(block.payload.characterId);
    const expressionMember = row.groupRole === "member"
        && block.kind === "action" && block.payload.action === "character" && block.payload.operation === "expression";
    // Every non-dialogue, non-narration/note row carries a low-key colour bar at its left edge, so
    // scene / character / sound / flow rows read apart at a glance. Same single source as the badge
    // (STORY_COMMAND_GROUPS in storyCommandCategories.ts, read through getBlockBadgeInfo - the group,
    // not the category, is the colour unit); narration/note and in-group expression members keep zero
    // chrome.
    const categoryColor = !isDialogue && !hideBadge && row.groupRole !== "member" ? getBlockBadgeInfo(block).iconColor : null;
    /**
     * A run of dialogue is named once, at its head. The continuations are joined to it by a connector
     * dropped from under the head's plate — the run reads as one block with one attribution, which a
     * repeated name cannot do however quietly it is printed.
     */
    const namesSpeaker = isDialogue && !dialogueMember && !containerInfo;
    /**
     * The group connector: one line hanging from the head's plate, down past every continuation, and
     * turning right into the last line of the run.
     *
     * It is drawn per row but must not LOOK drawn per row. Two rules follow from that, and both were
     * got wrong first time round: every segment butts square against the next (a radius on each one
     * pinched the line at every row boundary — a seam per row, which is exactly what a single line
     * must not have), and only the very last segment is rounded, because it is the only end there is.
     *
     * That last segment is an elbow rather than a stub: a line that simply stops is ambiguous about
     * whether the run ended or the list did, while one that turns toward the words it is attributing
     * says "this is the last of them" and points at the thing it means.
     */
    const railContinues = Boolean(row.groupContinues);
    const groupRail = isDialogue && (dialogueMember || railContinues)
        ? {
            // Measured from the ROW, so the line-number gutter counts too — the nesting connector lives
            // inside the content column and starts after it. Both land on the same x, which is the
            // point: a run's line and a block's line are the same line at the same place.
            left: `calc(var(--nl-story-gutter) + ${ROW_INDENT_STEP} * ${row.depth} + (var(--nl-story-avatar,28px) / 2))`,
            // A head hands the connector off from under its own plate; a continuation carries it in
            // from its own top edge, so consecutive rows join into one unbroken drop.
            top: dialogueMember ? 0 : ROW_CONTENT_PAD_PX + STORY_DENSITY_METRICS[props.density].avatar,
        }
        : null;
    /** The run's last line: the segment that ends, and therefore the only one that turns and rounds. */
    const railEnds = groupRail !== null && dialogueMember && !railContinues;
    /** Where a connector that ends on this row stops, and where one that opens a block leaves from. */
    const rowTextCentre = ROW_CONTENT_PAD_PX + STORY_DENSITY_METRICS[props.density].rowBox / 2;
    const rowPlateBottom = ROW_CONTENT_PAD_PX + STORY_DENSITY_METRICS[props.density].avatar;
    /**
     * Whether the pointer is on this row, kept local so a hover re-renders one row and nothing else.
     *
     * It gates the *mounting* of the hover cluster. Those buttons were always in the DOM, merely
     * invisible: three buttons and their icons on every row of the document, which is a third of a
     * row's nodes bought for the one row the pointer is actually on. The drag handle is deliberately
     * NOT gated — it is `tabIndex={0}` and reachable by keyboard, so it has to exist to be focused.
     */
    /**
     * Row lint. Cheap (two lookups) and derived, so it costs a memoised row nothing until something
     * about that row actually changes.
     */
    const diagnostic = diagnoseRow({ block, context: props.commandContext });
    const [hovered, setHovered] = useState(false);
    const [gripFocused, setGripFocused] = useState(false);
    const reduceMotion = useReduceMotion();
    const showRowActions = hovered || active;
    // The grip and the line number occupy one box, so exactly one of them is visible at a time.
    const showGrip = hovered || gripFocused;
    // Reordering a row writes the scene. Everything else this row does - selecting, folding, reading
    // its text, hovering its portrait - does not, and is left alone.
    const freeze = useFreezeGuard();
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
        id: row.block.id,
        // Off at dnd-kit rather than only in the handle, so a keyboard activation of the grip cannot
        // start a drag either.
        disabled: freeze.frozen,
        // Reduce-motion means the sort animation is off at the source, not merely overridden in CSS:
        // dnd-kit writes this transition as an inline style, which the stylesheet's blanket rule
        // cannot reach.
        transition: reduceMotion ? null : undefined,
    });
    // Withheld whole while frozen rather than left attached and inert: a grip that picks the row up and
    // then refuses to drop it reads as a broken editor.
    const dragListeners = freeze.gesture(listeners) ?? {};
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
                // Height comes from the density's single-line box plus the content column's `py-1`, so
                // every column can centre inside the same box (see STORY_DENSITY_METRICS). `items-start`
                // is load-bearing: a wrapped line keeps its first line aligned with the badge.
                "group relative grid min-h-[calc(var(--nl-story-row-box)+0.5rem)] grid-cols-[var(--nl-story-gutter)_1fr] items-start border-l-2 pr-3",
                selected ? "border-primary bg-primary/20" : active ? "border-primary bg-fill-subtle" : "border-transparent hover:bg-fill-subtle",
                // A disabled row (WI-3) dims whole — muted content, kept line number — but no invented
                // chrome; the runtime treats it as absent.
                row.disabled ? "opacity-45" : "",
            ].join(" ")}
            onClick={on.onSelect}
            onContextMenu={on.onContextMenu}
            onMouseDown={on.onMouseDown}
            onMouseEnter={() => {
                setHovered(true);
                on.onMouseEnter();
            }}
            onMouseLeave={() => setHovered(false)}
            onDoubleClick={event => {
                event.stopPropagation();
                // Double-click is the "show me this row" gesture, so it brings the property editor out
                // of a collapsed rail — for every kind of row, including the text ones whose second
                // click is already spoken for below. Reveal only: focus stays in the scene, so the
                // caret this same gesture is placing is not taken away from the author.
                //
                // Deliberately NOT gated on `editing`. A first version skipped a row already open for
                // editing, on the theory that a double-click inside a live field is word selection
                // rather than a request to inspect. Driving it proved the state does not exist: a
                // plain click on a row's text opens it from the mouseup gesture, so `editing` is
                // ALREADY true when the second click lands and the gate silently excluded every text
                // row — the majority of a scene.
                on.onRevealInspectorPanel();
                // A row that holds text enters edit from the mouseup gesture, which carries the
                // author's selection in with it — a double-click there is that gesture's second
                // click and is already handled. Empty text rows and action rows have no selection to
                // preserve, so they still open from here.
                if ((event.target as HTMLElement | null)?.closest?.("[data-story-row-text]")) {
                    return;
                }
                textSegment ? on.onStartTextEdit() : on.onOpenInspector();
            }}
        >
            {block.kind === "action" && block.payload.action === "setBackground" ? (
                <BackgroundRowArtwork payload={block.payload} selected={selected} active={active} />
            ) : null}
            {categoryColor ? (
                // 3px at 0.85, not 2px at 0.55: the dimmed hairline measured 2.87:1 against the
                // editor backdrop — under the 3:1 floor for non-text, and it is the only thing telling
                // a `/bg` row from a `/sound` one at a glance.
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
                    style={{ backgroundColor: categoryColor, opacity: 0.85 }}
                />
            ) : null}
            {groupRail ? (
                <ConnectorSegment
                    left={groupRail.left}
                    top={groupRail.top}
                    ends={railEnds}
                    elbow={railEnds}
                    stopAt={rowTextCentre}
                    highlight={selected || active}
                />
            ) : null}
            {/* Line number and drag grip share one box: they are both "this row, as a thing to point
                at", they are never both wanted, and giving each its own column cost 20px of every row
                to show one of them at a time. The number yields on hover (and to a focused grip, so
                the keyboard path is not a hover-only feature). */}
            <div className="relative flex h-full items-start justify-end pr-2 pt-1 text-2xs tabular-nums text-fg-subtle/60 transition-colors group-hover:text-fg-subtle">
                <div className="flex min-h-[var(--nl-story-row-box)] items-center gap-0.5">
                    {canFold ? (
                        <button
                            type="button"
                            className="rounded-md text-fg-subtle hover:bg-fill hover:text-primary"
                            onClick={event => {
                                event.stopPropagation();
                                on.onToggleCollapsed();
                            }}
                        >
                            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                    ) : (
                        <span className="h-3.5 w-3.5" />
                    )}
                    <span style={{ opacity: showGrip ? 0 : undefined }}>{row.lineNumber}</span>
                </div>
                {/* Always mounted, never unmounted on blur: it is `tabIndex={0}` and has to exist to be
                    tabbed to. It centres in the same single-line box the number and the words use —
                    centring over the whole row would drift it below the line it grabs on a wrapped one. */}
                <div
                    ref={setActivatorNodeRef}
                    {...attributes}
                    {...dragListeners}
                    role="button"
                    tabIndex={0}
                    aria-label={t("story.rows.dragRow")}
                    title={freeze.frozen ? freeze.reason : t("story.rows.dragRow")}
                    className={`absolute right-2 top-1 flex h-[var(--nl-story-row-box)] w-[18px] touch-none select-none items-center justify-center rounded-md text-fg-subtle transition-opacity hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${showGrip ? "opacity-100" : "opacity-0"} ${freeze.frozen ? "cursor-not-allowed" : "hover:cursor-grab"}`}
                    onFocus={() => setGripFocused(true)}
                    onBlur={() => setGripFocused(false)}
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                >
                    <GripVertical className="pointer-events-none h-3.5 w-3.5" />
                </div>
            </div>
            <div className="relative min-w-0 py-1">
                <RowNesting
                    depth={row.depth}
                    nextDepth={row.nextRowDepth ?? 0}
                    opensBlock={Boolean(containerInfo) && !collapsed && block.childrenIds.length > 0}
                    stopAt={rowTextCentre}
                    plateBottom={rowPlateBottom}
                    highlight={selected || active}
                />
                <>
                {/* `items-start` with every chrome cell holding the single-line box open: on a wrapped
                    line the plate and the nametag stay level with the FIRST line — which is the line
                    they name — instead of drifting to the middle of the paragraph. */}
                <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-start gap-2" style={{ paddingLeft: rowIndent(row.depth) }}>
                    {/* The row's content in three fixed cells: plate, nametag, words. Nesting indents
                        the whole group — the plate is the leading edge of a row's content, and an
                        outline that indents only the words hides its own structure behind any line
                        long enough to reach the same x anyway. */}
                    <span className="flex min-h-[var(--nl-story-row-box)] w-[var(--nl-story-avatar,28px)] shrink-0 items-center" aria-hidden={dialogueMember || hideBadge}>
                        {expressionMember ? (
                            <GroupExpressionBead block={block} characters={characters} />
                        ) : dialogueMember || hideBadge ? null : (
                            <BlockBadge block={block} characters={characters} appearance={row.appearance} />
                        )}
                    </span>
                    {/* The nametag cell: fixed width, left-aligned, and never anything but a name. It
                        is the column's WIDTH that holds the words to one x, not the name's own length —
                        which is what lets the names read as a left-aligned band and the text beside
                        them still start on a single edge. */}
                    <span className="relative flex min-h-[var(--nl-story-row-box)] w-[var(--nl-story-name,56px)] shrink-0 items-center" style={textStyle}>
                        {namesSpeaker ? (
                            <CharacterSelectTrigger
                                characters={characters}
                                tempSpeakers={props.tempSpeakers}
                                characterId={block.kind === "nodeAction" && block.payload.action === "dialogue" ? block.payload.characterId : undefined}
                                speakerName={block.kind === "nodeAction" && block.payload.action === "dialogue" ? block.payload.speakerName : undefined}
                                onChoose={on.onSetSpeaker}
                                onCreateCharacter={on.onCreateCharacter}
                                suppressColor={selected}
                                column
                            />
                        ) : null}
                    </span>
                    {containerInfo ? (
                        <>
                            {/* A container header is a directive like any other: plate, then words. The
                                pill it used to wear was a fourth icon shape AND it started further left
                                than its own children's text, so a block never lined up with itself. */}
                            <span className="flex min-h-[var(--nl-story-row-box)] shrink-0 items-center truncate text-sm italic text-fg-muted" style={textStyle}>{containerInfo.pill}</span>
                            {lensMode ? <ContainerModeBadge mode={lensMode} /> : null}
                        </>
                    ) : null}
                    {containerInfo?.role === "branch" && containerInfo.hasCondition ? (
                        <ConditionChip
                            block={block}
                            scene={scene}
                            document={document}
                            onUpdatePayload={on.onUpdatePayload}
                        />
                    ) : null}
                    {containerInfo?.repeatTimes !== undefined ? (
                        <RepeatTimesField block={block} onUpdatePayload={on.onUpdatePayload} />
                    ) : null}
                    {expressionMember ? (
                        <GroupExpressionMember block={block} characters={characters} />
                    ) : editing && textSegment ? (
                        <TextEditBox
                            editorRef={textInputRef}
                            initialCaret={props.editInitialCaret}
                            onEditRichChange={on.onEditRichChange}
                            onMultiLinePaste={on.onMultiLinePaste}
                            onCommitTextEdit={on.onCommitTextEdit}
                            onExitTextEdit={on.onExitTextEdit}
                            onContinue={on.onContinue}
                            onArrowOut={on.onArrowOut}
                            onGoalColumnInvalidated={on.onGoalColumnInvalidated}
                            onBackspaceAtEmptyStart={on.onBackspaceAtEmptyStart}
                            onUndoBeyondRow={on.onUndoBeyondRow}
                            onRedoBeyondRow={on.onRedoBeyondRow}
                            onInsertAfter={on.onInsertAfter}
                            block={block}
                            scene={scene}
                            document={document}
                            characters={characters}
                        />
                    ) : textSegment || !containerInfo ? (
                        <BlockPreview
                            block={block}
                            scene={scene}
                            commandContext={props.commandContext}
                            document={document}
                            characters={characters}
                            onUpdatePayload={on.onUpdatePayload}
                        />
                    ) : null}
                    {/* The hover cluster is MOUNTED on every row and merely hidden, not conditionally
                        rendered.

                        Mounting it on hover took 80–108px of width away from the words, which re-wrapped
                        any line long enough to be near the edge — and because the text box centres its
                        content, the first line then jumped UPWARD as the paragraph grew a second line.
                        Text that moves under the pointer is the worst thing an editing surface can do,
                        and it happened on exactly the rows an author works on longest.

                        The nodes it costs are bounded now in a way they were not when this was written:
                        the list is windowed, so "every row" is one screenful. */}
                    {/* The lint mark and the voice indicator are NOT part of the hover cluster: they are
                        there to be noticed while reading, so they keep their own always-visible slot. */}
                    {containerInfo ? null : (
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                            {diagnostic ? <RowDiagnosticMark code={diagnostic.code} /> : null}
                            <StoryVoiceIndicator block={block} />
                        </div>
                    )}
                    <div
                        aria-hidden={!showRowActions}
                        className={[
                            "flex shrink-0 items-center gap-1 transition-opacity",
                            containerInfo ? "ml-auto" : "",
                            showRowActions ? "opacity-100" : "pointer-events-none opacity-0",
                        ].join(" ")}
                    >
                        {containerInfo ? (
                            <ContainerHeaderAdd info={containerInfo} onAdd={() => on.onAddInside(block.id)} />
                        ) : (
                            <>
                                {dialogueHead ? (
                                    <GroupHeadPositionControl position={row.appearance?.position} active={active} onSetPosition={on.onSetPosition} />
                                ) : null}
                                <RowActions onInsertAfter={on.onInsertAfter} onDelete={on.onDeleteRow} active={active} />
                            </>
                        )}
                        <RowPlayAction block={block} active={active} onPlay={() => on.onPlayFromRow(block.id)} />
                    </div>
                </div>
                {/* The footer and the container's tail "+" take the same indent the row's content does. */}
                <div style={{ paddingLeft: rowIndent(row.depth) }}>
                    {containerInfo ? (
                        <ContainerFooter
                            block={block}
                            info={containerInfo}
                            onAddInside={() => on.onAddInside(block.id)}
                            onAddBranch={branch => on.onAddBranch(block.id, branch)}
                        />
                    ) : null}
                </div>
                </>
            </div>
        </div>
    );
});


/**
 * The lint mark: a small warning glyph beside the voice indicator, with the reason on hover.
 *
 * Always visible rather than hover-revealed — the whole point is to be noticed while reading, and a
 * warning you have to go looking for is not one.
 */
function RowDiagnosticMark({ code }: { code: StoryRowDiagnosticCode }) {
    const { t } = useTranslation();
    const label = t(`story.diagnostics.${code}` as TranslationKey);
    return (
        <span
            className="grid h-5 w-5 shrink-0 place-items-center text-warning"
            title={label}
            aria-label={label}
            role="img"
        >
            <TriangleAlert className="h-3.5 w-3.5" />
        </span>
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
    onMultiLinePaste: (event: ClipboardEvent<HTMLDivElement>) => boolean;
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
}) {
    const { t } = useTranslation();
    // Second enforcement point for the row text (see isRowTextEditable): even with the state
    // transitions gated, a freeze can land while a row is already open, and the field would keep taking
    // keystrokes the browser applies on its own.
    const freeze = useFreezeGuard();
    const dialoguePayload = props.block.kind === "nodeAction" && props.block.payload.action === "dialogue"
        ? props.block.payload
        : null;
    const initialRuns = useMemo(() => segmentToRuns(getTextSegment(props.block)), [props.block]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const toolbarRef = useRef<RichTextToolbarHandle | null>(null);
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
    const [eventEdit, setEventEdit] = useState<EventClickInfo | null>(null);
    // The row's speaking character, resolved for the inline-expression picker (dialogue rows only).
    const rowCharacter = useMemo(
        () => props.characters.find(character => character.profile.getId() === dialoguePayload?.characterId) ?? null,
        [props.characters, dialoguePayload?.characterId],
    );
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

    const openEvent = (info: EventClickInfo) => {
        commitGuardRef.current = true;
        setEventEdit(info);
    };
    const closeEvent = () => {
        commitGuardRef.current = false;
        setEventEdit(null);
        props.editorRef.current?.focus();
    };
    // Toolbar "expression" button: insert a default event (the character's default form) at the
    // caret, then open the picker on it so the author refines form/differential/SE in one motion.
    const insertEvent = () => {
        const characterId = dialoguePayload?.characterId;
        if (!characterId) {
            return;
        }
        const info = props.editorRef.current?.insertEvent({ expression: { characterId } });
        if (info) {
            openEvent(info);
        }
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
            // The style strip is a portal on <body>, so it is NOT inside the container — and the
            // keyboard path walks focus straight into it (Tab from the field). Without this the very
            // first Tab committed the row and closed the editor, which is indistinguishable from the
            // toolbar simply not working. The pointer path never hit this: it prevents focus from
            // moving at all, which is what the `lastToolbarInteractRef` window above is for.
            if (active instanceof HTMLElement && active.closest("[data-rt-toolbar]")) {
                return;
            }
            props.onCommitTextEdit();
        }, 0);
    };

    return (
        <div
            ref={containerRef}
            // The nametag is the ROW's, not the field's (it lives in the name column), so opening a
            // dialogue for editing swaps the words and nothing else — not one glyph moves.
            //
            // `self-stretch` + the row box are what make that true, and they are not decoration. The
            // read-only body (`TextClickTarget`) stretches to the row's single-line box and centres its
            // glyphs in it; this field had neither, so under the row's `items-start` it collapsed to its
            // own content — measured at 21px against the body's 28 — and the same line sat 3.5px HIGHER
            // the instant the caret arrived, then dropped back on Escape. Identical on all six rows
            // measured, and it is the one motion an editing surface may never make: the words move away
            // from the click that was aiming at them.
            className="relative flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center self-stretch overflow-visible"
        >
            <RichTextToolbar ref={toolbarRef} editor={props.editorRef} anchorRef={containerRef} commitGuard={commitGuardRef} active={activeMarks} hasVariables={variableOptions.scene.length + variableOptions.saved.length + variableOptions.persistent.length > 0} canInsertEvent={Boolean(dialoguePayload?.characterId)} onInsertEvent={insertEvent} onReturnToText={() => props.editorRef.current?.focus()} />
            <RichTextInput
                ref={props.editorRef}
                initialRuns={initialRuns}
                initialCaret={props.initialCaret}
                readOnly={!isRowTextEditable(freeze.frozen)}
                // Edit in place, VS Code style: no box, no sunken background, no horizontal padding — the
                // caret lands exactly where the read-only text sat. The active/selected row highlight is
                // the "you are here" signal, so the field needs none of its own. See the interaction model.
                // A group member needs no indent of its own: the row holds the portrait column open
                // for it, so read and edit start at the same x and entering edit never jumps.
                className="min-h-[20px] flex-1 whitespace-pre-wrap break-words bg-transparent text-fg outline-none empty:before:italic empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]"
                style={textStyle}
                placeholder={editorPlaceholder(props.block, t)}
                onChange={props.onEditRichChange}
                onMultiLinePaste={props.onMultiLinePaste}
                onBlur={handleBlur}
                onExit={props.onExitTextEdit}
                onEnter={props.onContinue}
                onShiftEnter={() => { props.onCommitTextEdit(); props.onInsertAfter(); }}
                onArrowOut={props.onArrowOut}
                // "Tab advances within a row" (interaction model, rule 3): within a row being edited,
                // the next thing to advance to is the style strip.
                onTab={backwards => toolbarRef.current?.enterFromEditor(backwards) ?? false}
                onGoalColumnInvalidated={props.onGoalColumnInvalidated}
                onBackspaceAtEmptyStart={props.onBackspaceAtEmptyStart}
                onUndoBeyondRow={props.onUndoBeyondRow}
                onRedoBeyondRow={props.onRedoBeyondRow}
                onPauseClick={openPause}
                onInterpolationClick={openInterp}
                onEventClick={openEvent}
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
            {eventEdit ? (
                <ExpressionPopover
                    anchor={eventEdit.anchor}
                    value={eventEdit.value}
                    character={rowCharacter}
                    onChange={event => {
                        props.editorRef.current?.updateEventAt(eventEdit.unit, event);
                        setEventEdit(current => (current ? { ...current, value: event } : current));
                    }}
                    onRemove={() => {
                        props.editorRef.current?.removeEventAt(eventEdit.unit);
                        closeEvent();
                    }}
                    onClose={closeEvent}
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
    // The two buttons that sit on every hovered row. Greyed with the freeze reason rather than hidden:
    // a row whose end cluster vanished would read as a broken editor, not as a frozen project.
    const freeze = useFreezeGuard();
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
            {/* Icons, not words: the cluster sits at the end of every row and two text buttons cost
                three times the width while saying what the glyph and its tooltip already say.
                What the accessible names must NOT do is inherit the old visible text: "Insert" and
                "Delete" were fine as words next to each other in a row's context, and are a verb with
                no object once they are the only thing a screen reader gets. They now carry the same
                sentence as the tooltip, minus the keybinding. */}
            <button
                type="button"
                tabIndex={-1}
                {...freeze.writes(false, t("story.rows.insertTitle", { keys: insertKeys }))}
                aria-label={t("story.rows.insert")}
                className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                onClick={event => {
                    event.stopPropagation();
                    props.onInsertAfter();
                }}
            >
                <Plus className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                tabIndex={-1}
                {...freeze.writes(false, t("story.rows.deleteTitle", { keys: deleteKeys }))}
                aria-label={t("story.rows.delete")}
                className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                onClick={event => {
                    event.stopPropagation();
                    props.onDelete();
                }}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

const STAGE_PLACEMENTS: { value: StoryStagePlacement; icon: typeof AlignLeft }[] = [
    { value: "left", icon: AlignLeft },
    { value: "center", icon: AlignCenter },
    { value: "right", icon: AlignRight },
];

/**
 * The dialogue group head's placement control (WI-3, M3.1): a hover-reveal dropdown that reads the
 * speaker's current `at=` and writes it back. It is a declarative shell — the controller keeps the
 * document as command lines (rewrites the enter/move `at=`, or inserts a `/move`), so this only ever
 * shows and picks left/center/right. Absent placement reads as the runtime default, center.
 */
function GroupHeadPositionControl(props: { position: StoryStagePlacement | undefined; active: boolean; onSetPosition: (position: StoryStagePlacement) => void }) {
    const { t } = useTranslation();
    // The strip is portalled to the body, not absolutely positioned in the row: the virtualiser gives
    // every row wrapper a `translateY`, and a transform makes a stacking context — so an in-row popup
    // is confined to its own row's box and the NEXT row, later in tree order, paints and hit-tests on
    // top of it. Anchoring against the viewport (the pattern of PausePopover and the quick-param
    // popover) is the only placement that outlives the row's box.
    const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const open = anchor !== null;

    useEffect(() => {
        if (!open) {
            return;
        }
        // "Outside" has to be asked of BOTH boxes now that the panel lives elsewhere in the DOM —
        // testing only the button would close on the very mousedown that begins a pick, unmounting
        // the item before its click could land.
        const onPointerDown = (event: Event) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            setAnchor(null);
        };
        // A viewport-anchored panel cannot follow the row, so whatever moves the row dismisses it.
        const onDetach = () => setAnchor(null);
        window.addEventListener("mousedown", onPointerDown, true);
        window.addEventListener("scroll", onDetach, true);
        window.addEventListener("resize", onDetach);
        return () => {
            window.removeEventListener("mousedown", onPointerDown, true);
            window.removeEventListener("scroll", onDetach, true);
            window.removeEventListener("resize", onDetach);
        };
    }, [open]);

    const currentValue = props.position ?? "center";
    const CurrentIcon = (STAGE_PLACEMENTS.find(placement => placement.value === currentValue) ?? STAGE_PLACEMENTS[1]).icon;

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                tabIndex={-1}
                title={t("story.position.label")}
                aria-label={t("story.position.label")}
                aria-expanded={open}
                className={[
                    "rounded-md p-1 transition-colors hover:bg-fill hover:text-primary",
                    open || props.active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    open ? "bg-fill text-primary" : "text-fg-muted",
                ].join(" ")}
                onClick={event => {
                    event.stopPropagation();
                    if (open) {
                        setAnchor(null);
                        return;
                    }
                    // Right-anchored, as it was: pinning the panel's right edge to the button's means
                    // the strip never has to know its own width.
                    const rect = event.currentTarget.getBoundingClientRect();
                    setAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                }}
            >
                <CurrentIcon className="h-4 w-4" />
            </button>
            {anchor ? createPortal(
                <div
                    ref={panelRef}
                    className="fixed z-[70] flex gap-0.5 rounded-lg border border-edge bg-surface-raised p-1 shadow-2xl"
                    style={{ top: Math.min(anchor.top, window.innerHeight - 48), right: Math.max(8, anchor.right) }}
                    onMouseDown={event => event.stopPropagation()}
                >
                    {STAGE_PLACEMENTS.map(placement => {
                        const Icon = placement.icon;
                        const selected = placement.value === currentValue;
                        return (
                            <button
                                key={placement.value}
                                type="button"
                                tabIndex={-1}
                                title={t(`story.position.${placement.value}` as TranslationKey)}
                                aria-label={t(`story.position.${placement.value}` as TranslationKey)}
                                aria-pressed={selected}
                                className={[
                                    "rounded-md p-1.5 transition-colors",
                                    selected ? "bg-primary/15 text-primary" : "text-fg-muted hover:bg-fill hover:text-fg",
                                ].join(" ")}
                                onClick={event => {
                                    event.stopPropagation();
                                    props.onSetPosition(placement.value);
                                    setAnchor(null);
                                }}
                            >
                                <Icon className="h-4 w-4" />
                            </button>
                        );
                    })}
                </div>,
                globalThis.document.body,
            ) : null}
        </>
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
                "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-fg-muted transition-opacity hover:bg-fill hover:text-primary group-hover:pointer-events-auto group-hover:opacity-100",
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

/**
 * The `gap-2` between a row's columns, in px.
 *
 * The group connector and the nesting guides are positioned outside that flex, so they have to add
 * the gaps back to find where a level's content begins.
 */
const ROW_GAP_PX = 8;

/**
 * The content column's own top padding (`py-1`), in px.
 *
 * The group connector is positioned on the ROW, which knows nothing of the column's padding, so a
 * head has to add it back to find the bottom edge of its own plate.
 */
const ROW_CONTENT_PAD_PX = 4;

/**
 * How far a connector's last segment turns right, in px.
 *
 * Short on purpose. Running it out to the name column's far edge was tried: it made the turn a
 * statement, and a line whose job is to say "these rows belong together" should not be making
 * statements at the end of every run and every block on the screen.
 */
const CONNECTOR_ELBOW_PX = 10;

/**
 * The connector's tone.
 *
 * One hairline at one weight, for both the things a row can belong to: the same-speaker run above it
 * and the container around it. They are the same relationship — "this row hangs off that one" — and
 * drawing them differently made a screen with both on it look like two systems.
 *
 * Thin and dim by intent: it is no longer load-bearing. When U1 raised this rail to 2px at full
 * `fg-subtle` it was the ONLY thing telling a continuation from a line of narration, so it had a
 * contrast floor to meet. The name column and the plate carry that now, and a connector loud enough
 * to be the answer is loud enough to be noise once it isn't.
 */
const CONNECTOR_FILL = "bg-fg-subtle/50";
const CONNECTOR_FILL_ACTIVE = "bg-primary/70";
// Kept apart from the fill on purpose: the elbow is drawn from borders around an EMPTY box, so handing
// it a background class as well — which one combined token quietly did — fills that box in and turns a
// hairline corner into a 10px slab.
const CONNECTOR_EDGE = "border-fg-subtle/50";
const CONNECTOR_EDGE_ACTIVE = "border-primary/70";

/**
 * One segment of a connector: a hairline down the row, stopping at the text's centre line when the
 * branch ends here, and turning right when this is also the deepest level that ends.
 *
 * Every segment butts square against its neighbours — a radius on each one pinches the line at every
 * row boundary, which is the one thing a single line must not do — so only the elbow is rounded,
 * being the only end there is.
 */
function ConnectorSegment(props: { left: string | number; top: number; ends: boolean; elbow: boolean; stopAt: number; highlight: boolean }) {
    if (props.elbow) {
        return (
            <span
                aria-hidden
                className={`pointer-events-none absolute rounded-bl-md border-b border-l ${props.highlight ? CONNECTOR_EDGE_ACTIVE : CONNECTOR_EDGE}`}
                style={{ left: props.left, top: props.top, height: props.stopAt - props.top, width: CONNECTOR_ELBOW_PX }}
            />
        );
    }
    return (
        <span
            aria-hidden
            className={`pointer-events-none absolute w-px ${props.highlight ? CONNECTOR_FILL_ACTIVE : CONNECTOR_FILL}`}
            style={props.ends
                ? { left: props.left, top: props.top, height: props.stopAt - props.top }
                : { left: props.left, top: props.top, bottom: 0 }}
        />
    );
}

/**
 * One nesting level's indent: the plate box plus the gap after it, so a child's plate lands where its
 * parent's NAME column starts.
 *
 * Two other steps were tried. A flat 20px put a child's plate to the LEFT of the text of the row
 * containing it, so a block read as rows that had been nudged rather than as one thing inside another.
 * The full content offset (plate + name + both gaps) put the child's plate on its parent's text edge —
 * which sounds right and reads badly: an action row already carries a speaker column it can never
 * fill, so at depth 1 that void stacked on top of the indent and a nested action's words began ~250px
 * in, with the pair of empty bands compounding at every further level.
 *
 * This step is a third of that. It cannot line a child's plate up with a column the eye already knows
 * — nothing sits at the parent's name edge on a row with no speaker — but it keeps a block's rows near
 * the reading column the rest of the document uses, which is what a script is mostly made of.
 *
 * A calc rather than a number because the plate box follows the reading density.
 */
const ROW_INDENT_STEP = `(var(--nl-story-avatar,28px) + ${ROW_GAP_PX}px)`;

/** The indent for content `levels` deep, as a CSS length. */
function rowIndent(levels: number): string {
    return `calc(${ROW_INDENT_STEP} * ${levels})`;
}


/**
 * The nesting connector: one line per ancestor level, hanging from that ancestor's plate, and turning
 * right into the last row of the block.
 *
 * It used to be a flat `bg-edge` hairline running the full height of every row it passed — no start
 * (it began at the first child's top edge, nowhere near the header that owns the block) and no end (it
 * ran off the bottom of the last child into whatever followed). It is now the SAME line, drawn by the
 * same component, as the one joining a run of dialogue to its speaker: both say "this row hangs off
 * that one", and drawing them differently made a screen carrying both look like two systems.
 *
 * `opensBlock` is the header's own half: an expanded container drops the line out from under its own
 * plate, exactly as a dialogue head does, so the block starts where the row that names it does.
 */
function RowNesting({ depth, nextDepth, opensBlock, stopAt, plateBottom, highlight }: {
    depth: number;
    nextDepth: number;
    opensBlock: boolean;
    /** Y of the row's text centre line: where a branch that ends here stops. */
    stopAt: number;
    /** Y of the bottom of this row's own plate: where a block's line leaves its header. */
    plateBottom: number;
    highlight: boolean;
}) {
    if (depth <= 0 && !opensBlock) {
        return null;
    }
    // Down the centre of the ancestor's plate at that level.
    const at = (level: number) => `calc(${ROW_INDENT_STEP} * ${level} + (var(--nl-story-avatar,28px) / 2))`;
    return (
        <>
            {Array.from({ length: depth }).map((_, level) => {
                // A preorder list: the branch at this level ends here when nothing deeper follows.
                const ends = nextDepth <= level;
                return (
                    <ConnectorSegment
                        key={level}
                        left={at(level)}
                        top={0}
                        ends={ends}
                        // Only the deepest level that ends here turns; the shallower ones that also end
                        // simply stop, because their own turn happened rows ago, at their last child.
                        elbow={ends && level === depth - 1}
                        stopAt={stopAt}
                        highlight={highlight && level === depth - 1}
                    />
                );
            })}
            {opensBlock ? (
                <ConnectorSegment left={at(depth)} top={plateBottom} ends={false} elbow={false} stopAt={stopAt} highlight={highlight} />
            ) : null}
        </>
    );
}

/**
 * The differential thumbnail an in-group expression row shows, sized as a bead on the group's rail
 * (U1). It lives in the gutter with the portraits, not in the text column: the row's words — the
 * differential's name — belong on the same baseline as every other line in the block, and anything
 * drawn in front of them would be a fourth left edge.
 */
function GroupExpressionBead({ block, characters }: { block: StoryBlock; characters: Character[] }) {
    const { url: imageUrl, frame, showingSprite } = useCharacterBadgeImage(block, undefined, characters);
    return (
        <span className="relative ml-[calc((var(--nl-story-avatar,28px)-1rem)/2)] h-4 w-4 shrink-0 overflow-hidden rounded-full border border-edge bg-fill-subtle">
            {imageUrl ? (
                showingSprite ? (
                    <HeadThumbnail url={imageUrl} alt="" frame={frame} className="h-full w-full" iconClassName="h-2.5 w-2.5" />
                ) : (
                    <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                )
            ) : null}
        </span>
    );
}

/**
 * The muted body of an in-group expression row (WI-5): the differential's name, and nothing else. It
 * stays an ordinary row (selection / drag / Enter live on the row around it); only the read-only
 * content is compacted.
 *
 * Its thumbnail moved out to `GroupExpressionBead` in the gutter (U1), so the label starts on the
 * block's one text baseline — a look change reads as a note inside the block rather than a line that
 * breaks it, and it adds no left edge of its own.
 */
function GroupExpressionMember({ block, characters }: { block: StoryBlock; characters: Character[] }) {
    const { t } = useTranslation();
    const label = useMemo(() => {
        if (block.kind !== "action" || block.payload.action !== "character") {
            return "";
        }
        // Ids, not names: resolving them to labels needs the character record, which this row
        // summary does not take. The inspector and the picker show the names.
        const parts: string[] = [];
        if (block.payload.pose) {
            parts.push(block.payload.pose);
        }
        parts.push(...Object.values(block.payload.tags ?? {}));
        return parts.join(" · ") || t("story.describe.charOp.expression");
    }, [block, t]);

    return (
        <span className="flex min-w-0 flex-1 items-center self-stretch text-2xs text-fg-subtle">
            <span className="min-w-0 truncate">{label}</span>
        </span>
    );
}

/**
 * The container header's label pill is gone: it was a bordered, tinted, small-caps chip — a fourth
 * icon form on a screen that already had three — and it started at the header's own left edge, which
 * is one column further left than the text of every row inside the block. A block that does not line
 * up with itself is the worst offender in a list read top-down.
 *
 * A header now renders exactly like the directives it contains: the same plate, carrying the same
 * category colour it always did (`getBlockBadgeInfo`), then its words in column 3.
 */

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
                className="min-w-0 max-w-[240px] truncate rounded-md border border-edge bg-fill-subtle px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-primary/50 hover:text-fg"
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
                className="w-14 rounded-md border border-edge bg-fill-subtle px-1.5 py-0.5 text-fg outline-none focus:border-primary/50"
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
                className="rounded-md px-1.5 py-1 text-2xs text-fg-muted hover:bg-fill hover:text-primary"
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
            <div className="mt-1 flex items-center gap-3 text-2xs text-fg-subtle" style={{ paddingLeft: rowIndent(1) }}>
                <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 hover:bg-fill hover:text-primary"
                    onClick={event => {
                        event.stopPropagation();
                        props.onAddBranch("elseIf");
                    }}
                >
                    + {t("story.container.elseIf")}
                </button>
                <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 hover:bg-fill hover:text-primary"
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
            className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs italic text-fg-subtle hover:bg-fill hover:text-fg-muted"
            style={{ marginLeft: rowIndent(1) }}
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

// ---------------------------------------------------------------------------
// Parallel / race containers.
//
// The staging lens (M7) used to render their children as a bar timeline down the right of the row.
// It is gone, machinery and all: a coloured bar with no ruler, no scale and no labels beside it reads
// as decoration, and it was the last thing in the list that did not obey the row's columns. Two of its
// side effects outlived its usefulness and were bugs on their own — it discarded the collapse flag for
// any container it had ever been switched on for (a permanently dead fold chevron), and it replaced a
// container's whole subtree with one row per direct child, silently hiding grandchildren. Their
// children are ordinary rows now, and the container's own footer carries the inside-add.
// ---------------------------------------------------------------------------

/** The engine-mode badge on a parallel/race header (WI-3): `all` / `allAsync` / `any`, in control colour. */
function ContainerModeBadge({ mode }: { mode: "all" | "allAsync" | "any" }) {
    const color = getCommandCategory("flow").iconColor;
    return (
        <span
            className="shrink-0 rounded-md border px-1 py-px font-mono text-2xs leading-none"
            style={{ color, borderColor: color }}
        >
            {mode}
        </span>
    );
}

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
 * The colours under the line being typed.
 *
 * Same mirror trick as the ghost hint below — the text repeated in a `pointer-events-none` layer with
 * the field's exact metrics — except this copy is the visible one: the textarea's own glyphs are made
 * transparent (its caret is not) so the roles show through. A textarea cannot colour parts of its
 * value, and every alternative is worse: a contenteditable would cost the caret model, the undo stack
 * and the IME handling that the plain field gets from the platform for free.
 *
 * **Held back during IME composition.** Chrome draws the composing text with the element's own colour,
 * so a transparent field would leave a Chinese author typing into an invisible box. `composing` puts
 * the real glyphs back for the length of the composition — the one case where the mirror cannot see
 * what the field is showing, since a composition is not in `value` yet.
 */
function CommandLineHighlight(props: { source: string; trigger: "/" | "@"; textStyle: CSSProperties }) {
    return (
        <span
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words"
            style={props.textStyle}
        >
            <StoryCommandLineText source={props.source} trigger={props.trigger} />
        </span>
    );
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
function CommandGhostHint(props: { value: string; source: string; caret: number; textStyle: CSSProperties; commandContext: StoryCommandContext; confirmation?: string }) {
    const { t } = useTranslation();
    // The slot's NAME is vocabulary — the word the author may type as `位置=` — so it follows the
    // command language. The failure sentence around it is prose and stays in the interface language.
    const { t: ct } = useCommandTranslation();
    // The ghost and reason parse the canonical "/" line (`source`); the invisible spacer below uses the
    // displayed `value` so it occupies the exact width the author sees ("@" and "/" render differently).
    //
    // `ct` is a dependency of both, though neither takes it as an argument: the parse is NOT a pure
    // function of (source, caret). The command locale is a hidden third input — it decides whether
    // `位置=` names a slot — so a locale switch changes the verdict with no keystroke to recompute on.
    // Without it a mid-typed line keeps its stale answer until the author types again.
    const ghost = useMemo(() => getCommandGhost(props.source, props.caret), [ct, props.caret, props.source]);
    // Why the line will not commit, if it will not. It outranks the hint: naming the next slot while
    // the line is already broken answers a question the author is no longer asking.
    const reason = useMemo(
        () => getCommandLineReason(props.source, props.commandContext),
        [ct, props.commandContext, props.source],
    );
    if (!ghost && !reason && !props.confirmation) {
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
            {props.confirmation ? (
                // The just-declared line's receipt (bible §3.5). It only ever rides an empty slot (the
                // commit clears the value and the next edit strips it), so it renders flush at the start.
                <span className="not-italic text-success/80">{props.confirmation}</span>
            ) : reason ? (
                <span className="text-danger/80">{`  ${t(reason.key, reason.params)}`}</span>
            ) : (
                <span className="italic text-fg-subtle">{`<${ct(`story.paramHint.${ghost!.hintKey}` as TranslationKey)}>`}</span>
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
    // The action creator is command vocabulary end to end — command names, their categories, the
    // param slots — so it reads the command language (`editor.localizedCommands`), which an author may
    // keep in English behind a Chinese interface. `t` stays for this slot's own chrome.
    const { t: ct } = useCommandTranslation();
    /**
     * The line being typed lives here, not in the editor's mode.
     *
     * A slot is one field; the editor around it is a list of every row in the scene. While the text
     * was editor state, a keystroke re-rendered that whole list — measurably, ~100ms per character on
     * a 400-row scene. Keeping it local means typing costs this component and nothing else; the
     * controller keeps its own copy in a ref (`insertDraftRef`) for the commit and resolve paths, fed
     * by `onValueChange`.
     *
     * The slot object is the identity of "which line is being typed", so a new slot re-seeds the
     * field. This is React's documented adjust-state-on-prop-change form rather than an effect: an
     * effect would render one frame of the previous slot's text into the new slot.
     */
    const [seededSlot, setSeededSlot] = useState(props.mode.slot);
    const [value, setValue] = useState(props.mode.initialValue);
    if (seededSlot !== props.mode.slot) {
        setSeededSlot(props.mode.slot);
        setValue(props.mode.initialValue);
    }
    const setLineValue = (next: string) => {
        setValue(next);
        props.onValueChange(next);
    };
    // The line the author sees keeps the trigger they typed; the parser, the cursor, and the command
    // search read the canonical "/" form (`source`). Same length, so `caret` indexes both.
    const source = useMemo(() => toCanonicalCommandLine(value, props.slashAtAlias), [value, props.slashAtAlias]);
    // Drop the trigger character (either "/" or "@") to get the query the menus rank against.
    const chooserQuery = value.slice(1);
    // The menu is derived from the text, never stored - so a reopened draft row always has its
    // completion (bible M3). Escape is the one thing text cannot express: `chooserDismissed` shuts the
    // menu until the next keystroke clears it (see the controller), so it forces "none" here.
    const chooser = props.mode.chooserDismissed ? "none" : insertChooserType(value, props.slashAtAlias);
    // The trigger this line is actually wearing — the author's own key, not the canonical "/".
    const trigger = actionTrigger(value, props.slashAtAlias) ?? ACTION_TRIGGER;
    // Composition state is local and short-lived: it exists only to hand the glyphs back to the field
    // while an IME is composing into it (see CommandLineHighlight).
    const [composing, setComposing] = useState(false);
    // Coloured only while the line IS a command: `insertChooserType` answers that from the text, and
    // `chooserDismissed` (Escape) must not change it — the line is still a command, the menu is just shut.
    const colourLine = !composing && isActionCommandLine(value, props.slashAtAlias);
    const menuAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuFrame = useAnchoredMenuFrame(menuAnchorRef, chooser !== "none", 312);
    const pluginCommands = useStoryPluginActionCommands();
    const actionOptions = useMemo<PaletteActionCommand[]>(
        () => searchActionCommands(
            [
                // The typing/filter tier lists one entry per spec — the ranked flat list is the right
                // shape while filtering, so a verb appears once even though it files under many subjects.
                ...specPaletteCommands().map(command => localizeSpecCommand(command, ct)),
                // A plugin action carries the label its own language pack already resolved.
                ...pluginCommands,
            ],
            chooserQuery,
        ),
        [chooserQuery, ct, pluginCommands],
    );
    // The browse is the sidebar's projection, not a second catalogue: same `accepts` classification
    // (WI-1). Handed over undeduped, because the menu's category column needs both readings of it —
    // 全部 collapses to one row per command (a verb repeated under six subjects with the same sentence
    // each time reads as six commands, not as one that reaches six places), while a chosen category
    // wants the full filing, where `/show` under 图片 is the answer rather than a repeat.
    const sidebarGroups = useMemo(
        () => buildSpecSidebarGroups(pluginCommands, command => localizeSpecCommand(command, ct)),
        [ct, pluginCommands],
    );
    const characterOptions = useMemo(
        () => getSpeakerCandidates(props.characters, props.tempSpeakers, chooserQuery),
        [chooserQuery, props.characters, props.tempSpeakers],
    );
    const actionMenu = useActionCommandMenuState(actionOptions, chooserQuery, sidebarGroups);
    const characterMenu = useCharacterPickerState(characterOptions);
    const textStyle = useStoryEditorTextStyle();

    // Where the caret is decides what the slot offers, so it has to be state: `/bg fo|` asks for an
    // image, `/bg forest_day t=|` for a transition, and only the caret tells them apart.
    const [caret, setCaret] = useState(props.mode.initialValue.length);
    // `ct` is a dependency here for the same reason it is one in `CommandGhostHint`: the command
    // locale is a hidden input to every parse, so a locale switch has to invalidate these too.
    const cursor = useMemo(() => getCommandCursor(source, caret), [ct, caret, source]);
    // `form=` can only list the forms of the character this line already named, so the candidates need
    // the args resolved so far.
    const resolvedArgs = useMemo(() => {
        const line = parseCommandLine(source);
        return line.kind === "command" && line.def ? resolveCommandLine(line, props.commandContext).args : {};
    }, [ct, props.commandContext, source]);
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
                // A param candidate leads with the slot's name in the command language and trails the
                // canonical key: the word being taught belongs in the reading column, the key it also
                // answers to in the footnote. It was the other way round, so a zh author read a column
                // of `t` `d` `at` with the words that explain them pushed to the margin.
                label: candidate.hintKey
                    ? ct(`story.paramHint.${candidate.hintKey}` as TranslationKey)
                    : candidate.label,
                // The kind a name belongs to is carried untranslated; it shares the subject vocabulary
                // the category strip already names, so it reads in the author's own language.
                detail: candidate.hintKey
                    ? candidate.label
                    : candidate.detailKind
                        ? t(commandCategoryLabelKey(subjectGroupId(candidate.detailKind)))
                        : candidate.detail,
                icon: icon?.icon,
                iconClassName: icon?.className,
                tag: candidate.free ? t("story.rows.tempSpeaker") : undefined,
                ...(candidate.free ? { free: true as const } : {}),
            };
        });
    }, [ct, cursor, props.commandContext, resolvedArgs, t]);
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
    const argMenuOpen = chooser === "action"
        && (cursor.kind === "paramName" ? argItems.length > 0
            : argValuePosition && (argItems.length > 0 || (cursor.query.length > 0 && hasCandidateSource(cursor.param, props.commandContext, resolvedArgs))));
    const actionMenuOpen = chooser === "action" && cursor.kind === "commandName";

    /**
     * Replace the token under the caret and put the caret after what was written. The slot's value is
     * controlled, so the caret has to be restored by hand once React has rendered the new text.
     */
    const applyCompletion = (text: string, replace: { start: number; end: number }) => {
        const next = value.slice(0, replace.start) + text + value.slice(replace.end);
        const nextCaret = replace.start + text.length;
        setLineValue(next);
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
            // Rebuild the whole line, keeping the trigger the author is using (`trigger`, resolved
            // above) so "@" does not flip to "/" mid-completion. The commit path canonicalizes either way.
            // The word the menu is SHOWING, not the canonical token: a pick that displayed 显示 and
            // wrote `@show` taught the author nothing they could type. `localizedCommandToken` comes
            // out of the same pass that built the parser's accept table, so it always reads back.
            applyCompletion(`${trigger}${localizedCommandToken(def)} `, { start: 0, end: value.length });
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
        <div data-story-insert-slot="" className="relative grid min-h-[calc(var(--nl-story-row-box)+0.5rem)] grid-cols-[var(--nl-story-gutter)_1fr] items-start border-l-2 border-primary bg-fill-subtle pr-3">
            <div className="flex min-h-[calc(var(--nl-story-row-box)+0.25rem)] items-center justify-end pt-1">
                <Plus className="h-3.5 w-3.5 text-primary" />
            </div>
            <div ref={menuAnchorRef} className="relative min-w-0 py-1">
                {/* Mirror a row's content column so the slot lines up with its future siblings: guide
                    rails + depth indent, then the badge and name columns, so the line being typed
                    starts on exactly the body edge the committed row will keep. */}
                <RowNesting
                    depth={props.depth ?? 0}
                    nextDepth={props.depth ?? 0}
                    opensBlock={false}
                    stopAt={ROW_CONTENT_PAD_PX + 14}
                    plateBottom={ROW_CONTENT_PAD_PX}
                    highlight={false}
                />
                <div style={{ paddingLeft: rowIndent(props.depth ?? 0) }}>
                <div className="flex min-h-[var(--nl-story-row-box)] items-center gap-2">
                <span className="w-[var(--nl-story-avatar,28px)] shrink-0" aria-hidden />
                <span className="w-[var(--nl-story-name,56px)] shrink-0" aria-hidden />
                {/* The ghost hint sits in a wrapper around the textarea rather than the row's own
                    anchor, so it is positioned against the field's box and inherits its exact metrics.
                    `min-w-0 flex-1` moves off the textarea onto the wrapper; the textarea then fills it. */}
                <div className="relative flex min-w-0 flex-1">
                {colourLine ? <CommandLineHighlight source={source} trigger={trigger} textStyle={textStyle} /> : null}
                <CommandGhostHint value={value} source={source} caret={caret} textStyle={textStyle} commandContext={props.commandContext} confirmation={props.mode.confirmation} />
                <textarea
                    ref={props.inputRef}
                    // Same in-place surface as an editing row (see TextEditBox): the new line reads as a
                    // line being typed, not a widget dropped into the list — which is what lets narration's
                    // Enter fall into this slot without the text visibly jumping.
                    className={[
                        "relative min-h-[20px] w-full resize-none bg-transparent px-0 py-0 outline-none placeholder:italic placeholder:text-fg-subtle",
                        // Transparent glyphs, opaque caret: the colours come from the mirror behind.
                        // Prose keeps its own text — there is nothing to colour, and a line the mirror
                        // would not draw must never be invisible.
                        colourLine ? "text-transparent caret-[rgb(var(--nl-fg))]" : "text-fg",
                    ].join(" ")}
                    style={textStyle}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                    rows={1}
                    value={value}
                    // The hint advertises whichever trigger this author actually uses. Suppressed while a
                    // declaration receipt occupies the ghost zone, so the two do not overprint on the
                    // empty slot; the next keystroke clears the receipt and the placeholder is moot anyway.
                    placeholder={props.mode.confirmation ? "" : t("story.rows.insertPlaceholder", { trigger: props.slashAtAlias ? "@" : "/" })}
                    onChange={event => {
                        const typed = event.target.value;
                        const typedCaret = event.target.selectionStart ?? typed.length;
                        // The verb settles into the command language the moment it is finished, so a
                        // hand-typed `@show` reads as the `@显示` the menu, the ghost and the committed
                        // row all say. Almost every keystroke returns null and takes the plain path.
                        const respelled = localizeCommandVerb(typed, typedCaret, props.slashAtAlias);
                        if (!respelled) {
                            setCaret(typedCaret);
                            setLineValue(typed);
                            return;
                        }
                        setCaret(respelled.caret);
                        setLineValue(respelled.value);
                        // Same hand-off as `applyCompletion`: the field is controlled, so the caret has
                        // to be put back once React has rendered the text that replaced what was typed.
                        window.requestAnimationFrame(() => props.inputRef.current?.setSelectionRange(respelled.caret, respelled.caret));
                    }}
                    // Fires on caret moves as well as selections — the slot has to follow the caret,
                    // not just the text, or clicking back into `/bg |forest` would still offer transitions.
                    onSelect={event => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
                    onBlur={() => {
                        if (chooser === "none") {
                            props.onCommitNarration(false);
                        }
                    }}
                    onKeyDown={event => {
                        if (event.key === "Backspace" && value === "" && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                            event.preventDefault();
                            props.onBackspaceEmpty();
                            return;
                        }
                        // Escape is one ladder, one rung per press: candidates first, then the slot.
                        // It never commits anything — that was the old behaviour that turned a
                        // half-typed `/set` into a line of prose the author never wrote.
                        if (event.key === "Escape") {
                            event.preventDefault();
                            chooser === "none" ? props.onDiscardSlot() : props.onDismissChooser();
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
                                actionMenu.move(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                            if (chooser === "character") {
                                event.preventDefault();
                                characterMenu.moveCharacter(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                        }
                        // ←/→ are never the menu's: they belong to the caret in the line being typed,
                        // in EVERY chooser. The command menu's category column is a mouse-driven
                        // filter for that reason — a column that took the arrows would cost `@shwo`
                        // its one-character fix, and the whole point of the slot is that it is text.
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
                                const command = actionMenu.activeStop?.command;
                                if (!command) {
                                    return false;
                                }
                                chooseCommandCandidate(command.id);
                                return true;
                            }
                            if (chooser === "character") {
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
                                chooser === "character" ? props.onCommitInvalid() : props.onResolveLine();
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
                        ranked={actionMenu.ranked}
                        sections={actionMenu.sections}
                        stops={actionMenu.stops}
                        category={actionMenu.category}
                        reachable={actionMenu.reachable}
                        onCategory={actionMenu.chooseCategory}
                        activeKey={actionMenu.activeStop?.key ?? null}
                        onHighlight={actionMenu.selectKey}
                        onChoose={chooseCommandCandidate}
                        onCancel={props.onDismissChooser}
                        frame={menuFrame}
                    />
                ) : null}
                {argMenuOpen ? (
                    <StoryCommandCandidateMenu
                        items={argItems}
                        activeKey={argMenu.activeItem?.key ?? null}
                        onHighlight={argMenu.selectItem}
                        onChoose={takeArgCandidate}
                        onCancel={props.onDismissChooser}
                        frame={menuFrame}
                    />
                ) : null}
                {chooser === "character" ? (
                    <CharacterPicker
                        characters={characterOptions}
                        activeCharacterId={characterMenu.activeCharacter?.key ?? null}
                        onHighlight={characterMenu.selectCharacter}
                        onChoose={candidate => candidate.kind === "character"
                            ? props.onChooseCharacter(candidate.character.profile.getId())
                            : props.onChooseTempSpeaker(candidate.name)}
                        onClear={props.onDismissChooser}
                        frame={menuFrame}
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

/**
 * Where a row menu opens, and the viewport box it opens into.
 *
 * These menus used to be `absolute` inside the row's own content column, which cannot work in this
 * list: the virtualiser gives every row wrapper a `translateY`, and a transform makes a stacking
 * context, so a panel that overhangs its own row is painted and hit-tested UNDER every row after it.
 * A `/` menu opened mid-list ended up interleaved with the next six rows' text and completely
 * unclickable. So the frame is measured against the VIEWPORT and the panel is portalled to the body,
 * where no row's box can confine it — the same shape the file's other popovers already use.
 */
type PopupPlacement = "above" | "below";
type AnchoredMenuFrame = { placement: PopupPlacement; style: CSSProperties };

const MENU_GAP_PX = 4;

/**
 * The box a menu carries before it has been measured — out of flow, and invisible.
 *
 * It cannot be an empty style. These panels portal into `document.body`, so a style with no
 * `position` drops a 420×256 block at the END OF THE DOCUMENT: the page grows past the viewport, the
 * window gains a scrollbar, and every pane in the editor re-lays-out one notch narrower — then back
 * again the moment the measure lands. Typing "@" made the whole editor jump. `fixed` keeps the panel
 * out of the document's flow whatever else is (not yet) known about it, and `hidden` keeps that first
 * frame from being seen or clicked at 0,0.
 */
const UNMEASURED_MENU_FRAME: AnchoredMenuFrame = {
    placement: "below",
    style: { position: "fixed", top: 0, left: 0, visibility: "hidden", pointerEvents: "none" },
};

function useAnchoredMenuFrame(anchorRef: RefObject<HTMLElement | null>, open: boolean, expectedHeight: number): AnchoredMenuFrame {
    const [frame, setFrame] = useState<AnchoredMenuFrame>(UNMEASURED_MENU_FRAME);

    // Layout, not passive: the menu mounts in the same commit that opens it, so the measure has to
    // land BEFORE that commit is painted. As a plain effect it painted once unplaced, which is the
    // frame the scrollbar flash above lived in.
    useLayoutEffect(() => {
        if (!open) {
            // Drop the closed menu's box. The next open may be a different row, and a stale frame
            // would place the panel over the old one for a frame. Same object identity every time, so
            // this bails out of re-rendering rather than looping.
            setFrame(UNMEASURED_MENU_FRAME);
            return;
        }
        const updateFrame = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            const gap = 8;
            const spaceBelow = window.innerHeight - rect.bottom - gap;
            const spaceAbove = rect.top - gap;
            const placement: PopupPlacement = spaceBelow < expectedHeight && spaceAbove > spaceBelow ? "above" : "below";
            setFrame({
                placement,
                style: {
                    position: "fixed",
                    left: rect.left,
                    // `maxWidth` rather than a clamped `left`: the panels carry fixed widths, and one
                    // anchor serves menus of several of them, so let a panel near the edge narrow
                    // instead of teaching the anchor every width it might have to hold.
                    maxWidth: Math.max(160, window.innerWidth - rect.left - 8),
                    ...(placement === "above"
                        ? { bottom: window.innerHeight - rect.top + MENU_GAP_PX }
                        : { top: rect.bottom + MENU_GAP_PX }),
                },
            });
        };
        updateFrame();
        // Tracked, not sampled once: a fixed panel cannot ride the list, so it has to be re-placed
        // whenever the anchor moves under it. `scroll` is captured so the editor's own scroller counts.
        const raf = window.requestAnimationFrame(updateFrame);
        window.addEventListener("resize", updateFrame);
        window.addEventListener("scroll", updateFrame, true);
        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", updateFrame);
            window.removeEventListener("scroll", updateFrame, true);
        };
    }, [anchorRef, expectedHeight, open]);

    return frame;
}

/** The category column's "no filter" entry — where the menu opens, and where it stays until asked. */
const ALL_MENU_CATEGORY = "all";
type MenuCategory = typeof ALL_MENU_CATEGORY | StoryCommandCategoryId;

/**
 * State for the inline `/` command menu: a category column on the left, its commands on the right.
 *
 * The column replaces nothing — the two display modes below are still the ones the typed text decides,
 * and 全部 (the default) leaves both exactly as they were. What it adds is the other way to narrow, for
 * an author who knows the *kind* of thing they want and not its name:
 *  - **browse** (empty query): the command set laid out under subject headers, the SAME projection the
 *    sidebar shows (`buildSpecSidebarGroups`) — a generic verb appears under every subject its
 *    `accepts` names, so an author browsing 图片 finds "显示" exactly where the sidebar puts it. The two
 *    menus are one source now; the `/` browse is no longer a second catalogue filed single-point by
 *    `category` (plan 2026-07-26-003 WI-1).
 *  - **filter** (a query): under 全部, the matcher's ranked hits, flat across categories, best match
 *    first — the ranking is the point, so headers (and the multi-subject repetition) would only get in
 *    its way. Under a chosen category the sections stay and the query ranks *within* them, which is
 *    what makes "sound, something about fading" reachable in two moves.
 *
 * Which subjects a category shows follows the sidebar's rule, for the same reason it does there: 全部
 * is the whole vocabulary at once and collapses to one row per command, while a chosen category brings
 * the full filing back — "everything I can do to an Image" has to list `/show`, and there it is the
 * answer rather than a repeat.
 *
 * The column takes no keys. ↑/↓ walk the commands and Enter takes one, exactly as they did before the
 * column existed; ←/→ stay the caret's, in this chooser as in every other. A column that answered to
 * the arrows would have to take them from the text being typed, and the slot is a line of text first —
 * `@shwo` has to be fixable with one ← and one keystroke. So the category is chosen with the pointer,
 * and it narrows what the keyboard then walks.
 *
 * `allGroups` is the undeduped sidebar projection; `options` is the ranked flat list for the query.
 * Either way the highlight walks `stops` — one stop per rendered row, keyed by `group:id` so a verb
 * that files under six subjects is six distinct stops. That composite key is what keeps rule 2 true:
 * one keypress moves one stop, one row is `active`, and Enter takes the row on screen rather than the
 * first row that shares its id (see {@link browseMenuStops}).
 */
function useActionCommandMenuState(
    options: PaletteActionCommand[],
    query: string,
    allGroups: readonly StoryCommandSidebarGroup[],
) {
    const browse = query.trim() === "";
    const [category, setCategory] = useState<MenuCategory>(ALL_MENU_CATEGORY);
    // 全部 with a query is the one case that stays flat: the ranking is the answer there, and a header
    // over each hit would only argue with it.
    const ranked = category === ALL_MENU_CATEGORY && !browse;

    /** The sections the right column shows — the chosen category's filing, narrowed by the query. */
    const sections = useMemo<readonly StoryCommandSidebarGroup[]>(() => {
        const scoped = category === ALL_MENU_CATEGORY
            ? dedupeToPrimarySubject(allGroups)
            : filterSidebarGroups(allGroups, category);
        if (browse) {
            return scoped;
        }
        return scoped
            .map(entry => ({ ...entry, commands: searchActionCommands(entry.commands, query) }))
            .filter(entry => entry.commands.length > 0);
    }, [allGroups, browse, category, query]);

    /**
     * Which categories the current query can still reach, so the column can dim the ones it cannot.
     * Dimmed, not hidden: a column whose entries come and go as you type is a column you cannot aim at.
     */
    const reachable = useMemo<ReadonlySet<MenuCategory>>(() => {
        const reached = new Set<MenuCategory>();
        for (const entry of allGroups) {
            const hits = browse ? entry.commands : searchActionCommands(entry.commands, query);
            if (hits.length > 0) {
                reached.add(ALL_MENU_CATEGORY);
                reached.add(entry.group.category);
            }
        }
        return reached;
    }, [allGroups, browse, query]);

    // The rows the menu shows, in the order the highlight walks them: the ranked flat list under 全部
    // with a query, the section projection everywhere else.
    const stops = useMemo<readonly StoryCommandMenuStop[]>(() => {
        if (ranked) {
            return options.map(command => {
                const group = getCommandGroup(command.group);
                return { key: `${group.id}:${command.id}`, group, command };
            });
        }
        return browseMenuStops(sections);
    }, [options, ranked, sections]);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const activeStop = stops.find(stop => stop.key === activeKey) ?? stops[0] ?? null;

    useEffect(() => {
        setActiveKey(current => stops.some(stop => stop.key === current) ? current : stops[0]?.key ?? null);
    }, [stops]);

    const selectKey = (key: string) => {
        setActiveKey(key);
    };

    /**
     * Picking a category is a pointer gesture only, and it does not move the highlight itself — the
     * effect above does, because the new category is a new `stops` and the old key is not in it.
     */
    const chooseCategory = (next: MenuCategory) => {
        setCategory(next);
    };

    /** ↑/↓ — one step down the commands. Wraps. The category column is never what the arrows walk. */
    const move = (direction: -1 | 1) => {
        if (stops.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, stops.findIndex(stop => stop.key === activeStop?.key));
        const nextIndex = (currentIndex + direction + stops.length) % stops.length;
        setActiveKey(stops[nextIndex].key);
    };

    return {
        ranked,
        sections,
        reachable,
        category,
        chooseCategory,
        stops,
        activeStop,
        activeKey,
        selectKey,
        move,
    };
}

function ActionCommandMenuRow(props: {
    stop: StoryCommandMenuStop;
    active: boolean;
    onHighlight: (key: string) => void;
    onChoose: (commandId: string) => void;
}) {
    const { command, group } = props.stop;
    // The icon follows the SECTION, not the command's own filing: `/show` listed under 图片 must not
    // wear a person glyph just because its `category` says 角色 (the sidebar's rule, shared here).
    const Icon = group.icon;
    return (
        <button
            type="button"
            role="option"
            aria-selected={props.active}
            data-action-command-key={props.stop.key}
            className={[
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                props.active ? "bg-primary/15 text-fg" : "hover:bg-fill",
            ].join(" ")}
            onMouseDown={() => props.onChoose(command.id)}
            onMouseEnter={() => props.onHighlight(props.stop.key)}
        >
            <Icon className="h-4 w-4 shrink-0" style={{ color: group.iconColor }} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{command.label}</span>
                {command.detail ? <span className="block truncate text-2xs text-fg-subtle">{command.detail}</span> : null}
            </span>
        </button>
    );
}

/**
 * One entry in the menu's category column.
 *
 * `onMouseDown` rather than `onClick`, like every row in this menu: the slot's textarea holds focus,
 * and a click that lands after the blur has already closed the chooser picks nothing.
 *
 * The chosen one wears a plain fill, never the accent the command rows use: the accent means "Enter
 * takes this", and only one thing in the menu can mean that. A category is what the list is OF.
 */
function ActionCommandCategoryRow(props: {
    icon: typeof LayoutGrid;
    iconColor: string;
    label: string;
    active: boolean;
    empty: boolean;
    onSelect: () => void;
}) {
    const Icon = props.icon;
    return (
        <button
            type="button"
            title={props.label}
            aria-current={props.active ? "true" : undefined}
            className={[
                "flex h-7 w-full shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors",
                props.active ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                props.empty && !props.active ? "opacity-45" : "",
            ].join(" ")}
            onMouseDown={props.onSelect}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: props.iconColor }} />
            <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>
        </button>
    );
}

function ActionCommandMenu(props: {
    ranked: boolean;
    sections: readonly StoryCommandSidebarGroup[];
    stops: readonly StoryCommandMenuStop[];
    category: MenuCategory;
    reachable: ReadonlySet<MenuCategory>;
    onCategory: (category: MenuCategory) => void;
    activeKey: string | null;
    onHighlight: (key: string) => void;
    onChoose: (commandId: string) => void;
    onCancel: () => void;
    frame: AnchoredMenuFrame;
}) {
    const { t } = useTranslation();
    // Category names are the subject vocabulary the whole command surface is filed under, so they
    // follow the command language; the menu's own chrome ("no actions", the key strip) does not.
    const { t: ct } = useCommandTranslation();
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!props.activeKey) {
            return;
        }
        window.requestAnimationFrame(() => {
            const activeItem = listRef.current?.querySelector(`[data-action-command-key="${props.activeKey}"]`);
            activeItem?.scrollIntoView({ block: "nearest" });
        });
    }, [props.activeKey]);

    // A new category is a new list, so it starts at its top rather than wherever the last one was
    // scrolled to — the highlight moves to the first row, and it has to be the row you can see.
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = 0;
        }
    }, [props.category]);

    const rows = (
        <>
            {props.stops.length === 0 ? (
                // Centred in the whole column: the category column holds the menu open at its own
                // height, so a top-left line of text sits alone against a tall empty box and reads as
                // a list that failed to draw rather than as the answer "there is nothing here".
                <div className="flex h-full items-center justify-center">
                    <button type="button" className="rounded-md px-3 py-2 text-center text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onCancel}>
                        {t("story.actionCreator.noActions")}
                    </button>
                </div>
            ) : props.ranked ? (
                // 全部 with a query: the matcher's ranking, flat and best-first — headers would fight it.
                props.stops.map(stop => (
                    <ActionCommandMenuRow
                        key={stop.key}
                        stop={stop}
                        active={stop.key === props.activeKey}
                        onHighlight={props.onHighlight}
                        onChoose={props.onChoose}
                    />
                ))
            ) : (
                // The sidebar's projection, one section per subject, so the author sees "here is
                // everything you can do to an image" — a verb appearing under several subjects is
                // several rows, each its own highlight stop.
                props.sections.map(entry => {
                    const Icon = entry.group.icon;
                    return (
                        // The gap above a header separates it from the section before it, so the first
                        // one must not have it: it would sit the right column 8px lower than the left,
                        // and it is the one offset the two columns are lined up on.
                        <div key={entry.group.id} className="pt-2 first:pt-0">
                            <div className="flex items-center gap-1.5 px-2 pb-1 text-2xs font-medium tracking-wide text-fg-subtle">
                                <Icon className="h-3 w-3 shrink-0" style={{ color: entry.group.iconColor }} />
                                <span>{ct(commandCategoryLabelKey(entry.group.id))}</span>
                            </div>
                            {entry.commands.map(command => {
                                const key = `${entry.group.id}:${command.id}`;
                                return (
                                    <ActionCommandMenuRow
                                        key={key}
                                        stop={{ key, group: entry.group, command }}
                                        active={key === props.activeKey}
                                        onHighlight={props.onHighlight}
                                        onChoose={props.onChoose}
                                    />
                                );
                            })}
                        </div>
                    );
                })
            )}
        </>
    );

    return createPortal(
        <div
            className="z-[70] w-[420px] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-xl"
            style={props.frame.style}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {/* A fixed height, not a cap. Under `max-h`, the box took the taller column's height, and
                the category column is 284px against the cap's 288 — so a category whose commands did
                not fill the panel (镜头 has one, 工具 three) shrank the whole menu by those 4px and
                grew it back on the way out. Switching category is the one thing this column exists
                for, and it flinched every time. Same size whatever is open; only the right column
                scrolls. */}
            <div className="flex h-72">
                {/* Pointer-only, by design: the arrows belong to the caret in the line being typed.
                    So the chosen category wears a plain fill and the accent stays on the command row —
                    one live highlight, and it is always the one Enter will take. */}
                <div className="nl-no-scrollbar flex w-[96px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-edge bg-surface-sunken p-1 pt-3">
                    <ActionCommandCategoryRow
                        icon={LayoutGrid}
                        iconColor="#a8adb5"
                        label={ct("story.actionCategory.all")}
                        active={props.category === ALL_MENU_CATEGORY}
                        empty={!props.reachable.has(ALL_MENU_CATEGORY)}
                        onSelect={() => props.onCategory(ALL_MENU_CATEGORY)}
                    />
                    {STORY_COMMAND_CATEGORIES.map(category => (
                        <ActionCommandCategoryRow
                            key={category.id}
                            icon={category.icon}
                            iconColor={category.iconColor}
                            label={ct(commandCategoryLabelKey(category.id))}
                            active={props.category === category.id}
                            empty={!props.reachable.has(category.id)}
                            onSelect={() => props.onCategory(category.id)}
                        />
                    ))}
                </div>
                {/* Both columns open at the same height — `pt-3` here and on the categories, and no
                    gap above the first section header, so a browse, a ranked list and the category
                    column all start on one line. */}
                <div ref={listRef} className="nl-no-scrollbar min-w-0 flex-1 overflow-auto p-1 pt-3">
                    {rows}
                </div>
            </div>
        </div>,
        globalThis.document.body,
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
    frame: AnchoredMenuFrame;
    /**
     * The portalled panel, handed back so an owner's light-dismiss can recognise it. It is not inside
     * the anchor any more, and a check that only knows the anchor closes the menu on the very
     * pointerdown that starts a pick — the item unmounts before its `mousedown` can choose anything.
     */
    panelRef?: RefObject<HTMLDivElement | null>;
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

    return createPortal(
        <div
            ref={node => {
                listRef.current = node;
                if (props.panelRef) {
                    props.panelRef.current = node;
                }
            }}
            className="z-[70] max-h-72 w-[320px] overflow-auto rounded-xl border border-edge bg-surface-raised p-1 shadow-xl"
            style={props.frame.style}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.characters.length === 0 ? (
                <button type="button" className="w-full rounded-md px-2 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onClear}>
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
                                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
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
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-fill"
                        onMouseDown={props.onCreate}
                    >
                        <UserRoundPlus className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm text-fg">{props.createLabel}</span>
                    </button>
                </>
            ) : null}
        </div>,
        globalThis.document.body,
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
    /**
     * The nametag sits in the row's name column: left-aligned, at the body type size, and with its
     * leading padding pulled back out by a negative margin — the hover chip keeps its 4px, but the
     * first *glyph* lands exactly on the column's edge, so the names read as one left-aligned band
     * however long or short they are.
     */
    column?: boolean;
}) {
    const { t } = useTranslation();
    // A frozen row keeps its nametag readable and stops offering the picker, which is also the way a
    // new character gets created from a typed name.
    const freeze = useFreezeGuard();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const pickerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const frame = useAnchoredMenuFrame(rootRef, editing, 288);

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
            const target = event.target as Node;
            // The picker is portalled to the body, so "outside" has to be asked of it as well as of
            // the nametag. Without the second test this closes on the pointerdown that begins a pick.
            if (rootRef.current?.contains(target) || pickerRef.current?.contains(target)) {
                return;
            }
            close();
        };
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [editing]);

    if (!editing) {
        const unassigned = !committedName;
        return (
            <div ref={rootRef} className={["relative overflow-hidden", props.column ? "max-w-full" : "shrink-0"].join(" ")}>
                <button
                    type="button"
                    className={[
                        "flex max-w-full items-center truncate rounded-md px-1 py-0.5 text-left hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                        // `-ml-1` pulls the hover chip's leading padding back out of the layout, so the
                        // chip contributes exactly its glyphs and the name's FIRST one lands on the
                        // column edge. Medium weight, because in a column of its own the name is a
                        // scanning target: running the eye down the cast is the most common thing done
                        // to a script.
                        // `box-content` is load-bearing next to `w-fit`: under the default border-box,
                        // `width: fit-content` resolves to the GLYPHS' width and the chip's `px-1` then
                        // eats 8px out of it, so the name the column was measured from is the first one
                        // to truncate. Sizing the content box instead puts the padding outside it.
                        props.column ? "box-content -ml-1 w-fit font-medium" : "h-full min-h-[28px] text-sm",
                        unassigned ? "italic text-fg-subtle hover:text-primary" : props.speakerName ? "text-fg-muted" : characterColor ? "" : "text-primary",
                        props.className ?? "",
                    ].join(" ")}
                    style={(() => {
                        const base = props.style;
                        return characterColor ? { ...base, color: characterColor } : base;
                    })()}
                    onMouseDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    {...freeze.writes()}
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
        <div ref={rootRef} className={["relative overflow-visible", props.column ? "w-full" : "shrink-0"].join(" ")}>
            <input
                ref={inputRef}
                value={draft}
                // In the column the field needs more room than the column has (a name being typed is
                // often longer than any name in the cast yet), so it grows RIGHTWARDS over the words.
                // Anchored on the left, where the name's glyphs already start, so they do not jump
                // when the picker opens.
                className={[
                    "h-full min-h-[28px] rounded-md border border-primary/50 bg-surface-sunken px-1 py-0.5 text-sm text-fg outline-none",
                    props.column ? "absolute left-0 top-1/2 z-10 w-[160px] -translate-y-1/2" : "w-[128px]",
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
                frame={frame}
                panelRef={pickerRef}
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
): { characterId: string; pose?: string; tags?: StoryCharacterTagSelection; resolveVariant: boolean } | null {
    if (block.kind === "action" && block.payload.action === "character" && block.payload.characterId) {
        return { characterId: block.payload.characterId, pose: block.payload.pose, tags: block.payload.tags, resolveVariant: true };
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue" && block.payload.characterId) {
        // Only a *shown* appearance pictures an avatar — a placement-only appearance (a `/move` on a
        // never-shown speaker, used by the group-header dropdown) must not invent a look (WI-3, M3.1).
        return { characterId: block.payload.characterId, pose: appearance?.pose, tags: appearance?.tags, resolveVariant: appearance?.shown === true };
    }
    return null;
}

/**
 * Longest edge of a composited badge sprite. The plate itself tops out at 40px (U1's comfortable
 * density) and the head crop reads a sub-rectangle of it, so this is the largest useful size at 2x.
 */
const BADGE_COMPOSITE_PX = 96;

/**
 * The sprite `Asset` + portrait frame a character badge should picture, resolved against the same
 * rule the runtime uses (shared `representativeAssetId`). The frame is the pose's own portrait
 * override, else the profile default; `undefined` lets the badge fall back to the automatic head
 * crop. The `Asset` object (not just its id) is returned because a sprite is a *project* asset and
 * loads through the asset library, not the editor store.
 *
 * A layered character has no single sprite: this returns its bottom-most drawing layer, which the
 * badge uses only until the composite of the whole stack arrives (and as the fallback when the
 * compositor cannot draw). See {@link useCharacterBadgeImage}.
 */
function resolveCharacterBadgeImage(
    character: Character,
    pose: string | undefined,
    tags: StoryCharacterTagSelection | undefined,
    lookupAsset: (assetId: string) => Asset<AssetType.Image> | null,
): { asset: Asset<AssetType.Image> | null; frame?: NormalizedCrop } {
    const appearance = character.profile.appearance;
    const summary = appearance.getKind() === "preset"
        ? { kind: "preset" as const, poses: appearance.getPoses().map(p => ({ id: p.id, name: p.name, assetId: p.assetId })), defaultPoseId: appearance.getDefaultPoseId() }
        : { kind: "layered" as const, canvas: appearance.getCanvas(), axes: appearance.getAxes(), layers: appearance.getLayers() };
    const assetId = representativeAssetId(summary, { poseId: pose, tags });
    const frame = (pose ? appearance.getPose(pose)?.portrait : undefined) ?? character.profile.getPortrait();
    return { asset: assetId ? lookupAsset(assetId) : null, frame };
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
    // The appearance stores asset ids; the badge cache needs the `Asset` record to fetch bytes, so
    // the id is resolved against the live library here rather than embedded in the character store
    // (which is what the old variant slots did, and what made a renamed or replaced asset go stale).
    const { context, isInitialized } = useWorkspace();
    const lookupAsset = useCallback((assetId: string): Asset<AssetType.Image> | null => {
        if (!context || !isInitialized) {
            return null;
        }
        const assets = context.services.get<AssetsService>(Services.Assets).getAssets();
        return assets?.[AssetType.Image]?.[assetId] ?? null;
    }, [context, isInitialized]);
    const resolved = character && spec?.resolveVariant
        ? resolveCharacterBadgeImage(character, spec.pose, spec.tags, lookupAsset)
        : { asset: null as Asset<AssetType.Image> | null, frame: undefined };
    const thumbnailId = character?.profile.getThumbnail() ?? null;
    const source: BadgeImageSource | null = resolved.asset
        ? { kind: "project", asset: resolved.asset }
        : thumbnailId
            ? { kind: "editor", fileId: thumbnailId }
            : null;
    const fallbackUrl = useBadgeImageUrl(source);
    // A layered character is a stack, so the badge shows the whole thing composited. The single-asset
    // path above still runs: it is what the badge shows while the composite is being drawn, which
    // keeps a scrolling list from flashing empty plates.
    const layered = character && spec?.resolveVariant && character.profile.appearance.getKind() === "layered"
        ? character
        : null;
    const composite = useCompositedSprite(layered, { tags: spec?.tags }, BADGE_COMPOSITE_PX);
    const url = composite.url ?? fallbackUrl;
    return { url, frame: resolved.frame, showingSprite: Boolean(composite.url) || resolved.asset !== null };
}

/**
 * A row's leading plate: a speaker's face on a dialogue row, the command's category glyph on every
 * other one.
 *
 * `portrait` is what separates the two. A dialogue plate follows the reading density (U1) — 28px in
 * compact, 40px in comfortable, where it becomes the block's own column — because a differential
 * head, a crop selection and a nametag colour are all wasted below about 28px. A category glyph does
 * not grow with it: it is a 14px icon, and a 40px tile around it is chrome.
 */
function BlockBadge({ block, characters, appearance }: { block: StoryBlock; characters: Character[]; appearance?: CharacterAppearanceRef }) {
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);
    // A differential-resolved sprite (framed on the face) when a look applies; otherwise the profile
    // thumbnail (already a square crop, shown as-is); otherwise the category icon.
    const { url: imageUrl, frame, showingSprite } = useCharacterBadgeImage(block, appearance, characters);

    return (
        <span
            // ONE plate: one box, one radius, on every row that has one. It used to be a circle for a
            // speaker and a 28px square for a command, which at `standard` and `comfortable` density
            // put two sizes AND two shapes on the same screen — and bought nothing, because the name
            // column already says which rows are speech. A list is easier to read down when its
            // furniture is identical and only the content differs.
            className="relative inline-flex h-[var(--nl-story-avatar,28px)] w-[var(--nl-story-avatar,28px)] shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-fill-subtle"
            title={label}
            aria-label={label}
        >
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
    const { t: ct } = useCommandTranslation();
    const reason = useMemo(
        // `ct`: the command locale is a hidden input to the parse behind this reason. See `CommandGhostHint`.
        () => getCommandLineDraftReason(props.source, props.commandContext),
        [ct, props.commandContext, props.source],
    );
    // The sentence is prose (interface language); the slot name interpolated into it is vocabulary
    // (command language), so a Chinese author reading an English command line is told the slot is
    // missing in Chinese and told its name in the word they would have to type.
    const reasonText = reason
        ? t(reason.key, reason.paramHintKey ? { ...reason.params, slot: ct(reason.paramHintKey) } : reason.params)
        : t("story.rows.invalidHint");
    return (
        <span className="flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center gap-2">
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
    /** Commit an inline quick-param edit (WI-2) through the same history path the inspector uses. */
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const block = props.block;
    const text = getTextSegment(block);
    const textStyle = useStoryEditorTextStyle();
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
        return (
            <BackgroundBlockPreview
                block={block}
                payload={block.payload}
                characters={props.characters}
                scene={props.scene}
                scenes={props.document.scenes}
                onUpdatePayload={props.onUpdatePayload}
            />
        );
    }
    if (block.kind === "action" && block.payload.action === "displayable" && block.payload.operation === "transform") {
        return (
            <DisplayableTransformPreview
                block={block}
                payload={block.payload}
                sceneId={props.scene.id}
                blockId={block.id}
                document={props.document}
                characters={props.characters}
                scene={props.scene}
                onUpdatePayload={props.onUpdatePayload}
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
    // One overview path for every action row: the command line that would produce it, with any
    // quick-edit params clickable inside it — and the old `describeBlock` sentence for the rows no
    // command owns. setBackground / displayable-transform reach it through their own wrappers above,
    // which add the artwork the line cannot carry.
    return (
        <BlockOverview
            block={block}
            characters={props.characters}
            scene={props.scene}
            scenes={props.document.scenes}
            textStyle={textStyle}
            onUpdatePayload={props.onUpdatePayload}
        />
    );
}

/**
 * Width of the artwork strip at the row's trailing edge.
 *
 * The artwork used to be painted across the WHOLE row, held down on the left by a blurred scrim. Two
 * problems, one visual and one mechanical:
 *
 *  - A scene with a run of `/bg` rows turned into a wall of photographs with the prose floating on
 *    top of it. The pictures are a *reference* — "which image is this" — not the content of the line.
 *  - The scrim used `backdrop-filter`, one of the most expensive things a compositor can be asked
 *    for, and it was asked for once per background row on every frame that touched them. On a weak
 *    GPU that is a scroll-killer, and it bought contrast that a plain gradient buys for free.
 *
 * A bounded strip fixes both: the row reads as text again, the painted area drops by roughly three
 * quarters, and the fade is an ordinary gradient mask with no backdrop sampling anywhere.
 */
const BACKGROUND_STRIP_WIDTH = "max(180px, 32%)";
/**
 * Dissolves the strip's leading edge into the row instead of cutting a seam down the list. The fade
 * starts earlier than it did at 180px: over a third of the row, a hard 62% ramp reads as an edge.
 */
const BACKGROUND_STRIP_MASK = "linear-gradient(to right, transparent, #000 55%)";
/** The label's cap: the content column, less the strip it must not run under. */
const BACKGROUND_LABEL_MAX_WIDTH = `calc(100% - ${BACKGROUND_STRIP_WIDTH} - 24px)`;

/**
 * The picked background, as a strip at the row's trailing edge. Rendered only for background rows
 * with the inspector closed (its card carries its own picker), which also keeps the asset-url hook
 * off every other row in the list.
 *
 * Under reduce-motion the image is dropped for a plain colour block. That setting is the closest
 * thing Studio has to "this machine would rather not", and a photograph decoded per background row
 * is the single most expensive thing the row list asks of a weak machine.
 */
function BackgroundRowArtwork({ payload, selected, active }: {
    payload: Extract<StoryActionPayload, { action: "setBackground" }>;
    selected: boolean;
    active: boolean;
}) {
    const { url } = useAssetObjectUrl(payload.assetId ?? null);
    const reduceMotion = useReduceMotion();
    const color = !payload.assetId && payload.color ? payload.color : null;
    if (!url && !color) {
        return null;
    }
    const showImage = Boolean(url) && !reduceMotion;
    return (
        <span
            // A hairline top and bottom, so a run of `/bg` rows reads as one strip per row rather
            // than as a single tall picture down the side of the list.
            className="pointer-events-none absolute inset-y-px right-0 select-none overflow-hidden rounded-sm"
            style={{
                width: BACKGROUND_STRIP_WIDTH,
                maskImage: BACKGROUND_STRIP_MASK,
                WebkitMaskImage: BACKGROUND_STRIP_MASK,
            }}
            aria-hidden
        >
            {showImage ? (
                <img src={url ?? undefined} alt="" draggable={false} className="h-full w-full object-cover object-center" />
            ) : (
                <span className="block h-full w-full bg-fill" style={color ? { backgroundColor: color } : undefined} />
            )}
            {selected ? (
                <span className="absolute inset-0 bg-primary/25" />
            ) : active ? (
                <span className="absolute inset-0 bg-fill-subtle" />
            ) : null}
        </span>
    );
}

/**
 * A background row: the command line, held clear of the artwork strip at the row's trailing edge.
 *
 * The line says everything the old bespoke sentence did — `@背景 forest_day 转场=淡变 持续时间=0.5` names
 * the image, and the strip beside it shows which image that is — so the only thing this preview adds
 * over the shared overview is the width cap that keeps the text from running under the picture.
 */
function BackgroundBlockPreview({ block, payload, characters, scene, scenes, onUpdatePayload }: {
    block: StoryBlock;
    payload: Extract<StoryActionPayload, { action: "setBackground" }>;
    characters: Character[];
    scene: StoryScene;
    scenes: Record<StorySceneId, StoryScene>;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const textStyle = useStoryEditorTextStyle();
    return (
        <span
            className="flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center"
            style={{ maxWidth: payload.assetId || payload.color ? BACKGROUND_LABEL_MAX_WIDTH : undefined }}
        >
            <BlockOverview
                block={block}
                characters={characters}
                scene={scene}
                scenes={scenes}
                textStyle={textStyle}
                onUpdatePayload={onUpdatePayload}
            />
        </span>
    );
}

function DisplayableTransformPreview(props: {
    block: StoryBlock;
    payload: Extract<StoryActionPayload, { action: "displayable" }>;
    sceneId: StoryScene["id"];
    blockId: StoryBlock["id"];
    document: StoryDocument;
    characters: Character[];
    scene: StoryScene;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const textStyle = useStoryEditorTextStyle();

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
    const { url } = useAssetObjectUrl(assetId ?? null);

    const overview = (
        <BlockOverview
            block={props.block}
            characters={props.characters}
            scene={props.scene}
            scenes={props.document.scenes}
            textStyle={textStyle}
            onUpdatePayload={props.onUpdatePayload}
        />
    );

    // No resolvable image (a text/layer target, or a name nothing on stage answers to) — the line alone.
    if (!assetId) {
        return overview;
    }

    // The thumbnail stays: `/transform hero` says WHICH object, and the picture is the fastest answer
    // to "which one is that" on a scene full of them. It leads the line rather than sitting inside it,
    // so the command still starts on the same column as every other row's.
    return (
        <span className="flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center gap-2">
            <span className="h-5 w-8 shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
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
            {overview}
        </span>
    );
}
