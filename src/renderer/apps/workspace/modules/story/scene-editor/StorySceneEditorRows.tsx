import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClipboardEvent, CSSProperties, ReactNode, RefObject, MouseEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronRight, GanttChart, GripVertical, Image, LayoutGrid, List, Play, Plus, Trash2, TriangleAlert, UserRoundPlus } from "lucide-react";
import type { TempSpeakerRef } from "@/lib/workspace/services/story/storyModel";
import { useSortable } from "@dnd-kit/sortable";
import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryDocument, StoryRichRun, StoryScene, StorySceneId } from "@shared/types/story";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { isRowTextEditable } from "./storySceneReadOnly";
import { useCommandTranslation, useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { getCommandGhost } from "./storyCommandGhost";
import { getCommandLineDraftReason, getCommandLineReason } from "./storyCommandReason";
import { isMacPlatform } from "@/lib/app/platform";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useCharacterFace } from "./storyCharacterFace";
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
import {
    characterScopedActions,
    characterScopedSidebarGroups,
    characterScopeLead,
    dialogueActionCharacter,
} from "./storyCharacterActions";
import { localizeSpecCommand, specPaletteCommands } from "./commands/specPalette";
import { browseMenuStops, buildSpecSidebarGroups, dedupeToPrimarySubject, filterSidebarGroups, type StoryCommandMenuStop, type StoryCommandSidebarGroup } from "./commands/specSidebar";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { getCommandDef, getDefById, localizedCommandToken } from "./commands/registry";
import { localizeCommandVerb } from "./storyCommandSpelling";
import { completionFor, defaultHighlights, getCommandCursor, type StoryCommandCursor } from "./storyCommandCursor";
import { getCommandCandidates, hasCandidateSource, type StoryCommandCandidate } from "./storyCommandCandidates";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";
import type { StoryCommandValue } from "./storyCommandValues";
import { StoryCommandCandidateMenu, useStoryCandidateMenuState, type StoryCandidateItem } from "./StoryCommandCandidateMenu";
import { StoryCandidateSpeakerMark } from "./storyCandidateMark";
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
import { storyAppearanceLabel, type StoryAppearanceSelection } from "./storyAppearanceLabel";
import { STORY_DENSITY_METRICS, useStoryEditorTextStyle } from "./storyEditorTextStyle";
import { STORY_MARK_PX, STORY_ROW_CONTENT_PAD_PX } from "./StoryRowGutterMark";
import { characterIdentity, StoryRowGutter } from "./StoryRowGutter";
import { characterSpeakerIdentity, storySpeakerPaint, type StorySpeakerIdentity } from "./storySpeakerIdentity";
import type { StoryEditorDensity } from "./storyEditorSessionStore";
import type { StoryRowHighlight } from "@/lib/settings/storyRowHighlightOptions";
import type { CharacterAppearanceRef, EditorMode, StoryCaretTarget, StoryStagePlacement, VisibleStoryRow } from "./storySceneEditorTypes";
import {
    canAcceptChildren,
    describeBlock,
    getBlockBadgeInfo,
    storyRowLayer,
    getCharacterName,
    getContainerHeaderInfo,
    getEmptyTextPlaceholder,
    getTextSegment,
    isContainerBlock,
    type StoryContainerHeaderInfo,
} from "./storySceneBlockUtils";
import { ConditionPopover } from "./ConditionPopover";
import { EMPTY_EXPRESSION_CONDITION } from "./ConditionEditor";
import { BlockOverview } from "./storyQuickParams";
import { actionTrigger, ACTION_TRIGGER, insertChooserType, isActionCommandLine, toCanonicalCommandLine } from "./commandTrigger";
import { StoryCommandLineText, useStoryCommandLineContext } from "./StoryCommandLineView";
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
    /**
     * Which layer wears a tint (`editor.storyRowHighlight`). A prop rather than a hook read per row:
     * the hook costs an IPC round trip per mount and a scene is hundreds of rows, so the tab resolves
     * it once — and as a prop it crosses the memo boundary, which is what makes the whole list repaint
     * when the author changes it.
     */
    rowHighlight: StoryRowHighlight;
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
    const isDialogue = block.kind === "nodeAction" && block.payload.action === "dialogue";
    /**
     * Which of the two layers this row is in (gutter 规范 §1) — and therefore whether it takes a tint.
     *
     * Script rows keep the page's own background; machinery gets a block of it, which is what lifts a
     * directive out of the narrative flow without giving it a colour, a badge or a border. Read down a
     * scene, the tinted rows recede and what is left is very nearly a plain script.
     */
    /**
     * Whether this row's layer is the one the author asked to have painted (`editor.storyRowHighlight`).
     *
     * The LAYERS are not optional — a row either gets performed or it does not, and the gutter mark
     * says which on every row in every mode. What the setting decides is whether that fact is also
     * painted, and which half carries the paint: the script (for writing) or the directives (for
     * staging). Neither, by default, because on a script-heavy scene the tint only repeats what the
     * mark already said.
     */
    const highlighted = props.rowHighlight !== "none"
        && storyRowLayer(block) === (props.rowHighlight === "script" ? "script" : "machine");
    /**
     * A continuation: a later line of the paragraph that opened above it (§2). It drops its name — the
     * paragraph was named once, at its head — and its gutter carries the run's rule instead of a mark.
     */
    const continuationRow = row.groupRole === "member";
    // A dialogue group head backed by a real character carries the hover-reveal placement dropdown
    // (WI-3): a standalone line is a run of one, so it counts too. A bare-name speaker has no character
    // to place, so it gets none.
    const dialogueHead = isDialogue && !continuationRow
        && block.kind === "nodeAction" && block.payload.action === "dialogue" && Boolean(block.payload.characterId);
    /**
     * A paragraph is named once, at its head, and the name is printed in front of the words rather
     * than filed in a column beside them: 「Anyo 大家好啊」 is one utterance read left to right.
     *
     * The continuations carry no name at all. Reprinting it on every line cannot say what the gutter's
     * rule says however quietly it is printed — it says "and now, again, Anyo", when what is true is
     * that Anyo never stopped.
     */
    const namesSpeaker = isDialogue && !continuationRow && !containerInfo;
    /** Where a nesting connector that ends on this row stops, and where one that opens a block leaves from. */
    const rowTextCentre = ROW_CONTENT_PAD_PX + STORY_DENSITY_METRICS[props.density].rowBox / 2;
    const rowMarkBottom = ROW_CONTENT_PAD_PX + STORY_MARK_PX;
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
    // Whether this row's trailing controls land on the artwork strip rather than on the row's own
    // surface (see `.nl-on-media` in styles.css). The same condition the strip itself is drawn on —
    // a `/bg` row with something to show — because the strip is right-aligned and the controls are
    // the only things over it.
    const controlsOverArtwork = block.kind === "action"
        && block.payload.action === "setBackground"
        && Boolean(block.payload.assetId || block.payload.color);
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
                // is load-bearing: a wrapped line keeps its first line aligned with its mark.
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
            {highlighted && !selected && !active ? (
                /*
                 * The layer tint (gutter 规范 §1) — the only thing a row's background ever means, and
                 * the one part of the two-layer model the author gets to turn off.
                 *
                 * What it replaced was a 3px category-coloured bar at the row's left edge: one hue per
                 * command group, so a screen of directives was also a screen of coloured bars, and the
                 * loudest thing in a scene was the machinery rather than the script. §3.2 forbids that
                 * outright — a directive's channel is monochrome line, nothing else — and what the bar
                 * was actually for (telling a `/bg` row from a `/sound` one) the row's own verb glyph
                 * now does, without spending colour on it.
                 *
                 * Withdrawn under selection and while active, because those states paint the whole row
                 * and a tint underneath would only mix with them.
                 */
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-fill-subtle" />
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
                    markBottom={rowMarkBottom}
                    highlight={selected || active}
                />
                <>
                {/* `items-start` with the gutter cell holding the single-line box open: on a wrapped
                    line the mark stays level with the FIRST line — which is the line it names —
                    instead of drifting to the middle of the paragraph. */}
                <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-start" style={{ paddingLeft: rowIndent(row.depth), gap: ROW_GAP_PX }}>
                    {/* Two cells now, not three: the "who is speaking" gutter and the words. Nesting
                        indents both together — the mark is the leading edge of a row's content, and an
                        outline that indents only the words hides its own structure behind any line
                        long enough to reach the same x anyway. */}
                    <StoryRowGutter
                        row={row}
                        characters={characters}
                        appearance={row.appearance}
                        active={hovered || active || selected}
                    />
                    {containerInfo ? (
                        <>
                            {/* A container header is a directive like any other: mark, then words. The
                                pill it used to wear was a fourth icon shape AND it started further left
                                than its own children's text, so a block never lined up with itself. */}
                            <ContainerHeaderWord info={containerInfo} textStyle={textStyle} />
                            {lensMode ? <span className={HEADER_SLOT_CLASS}><ContainerModeBadge mode={lensMode} /></span> : null}
                        </>
                    ) : null}
                    {containerInfo?.role === "branch" && containerInfo.hasCondition ? (
                        <span className={HEADER_SLOT_CLASS}>
                            <ConditionChip
                                block={block}
                                scene={scene}
                                document={document}
                                onUpdatePayload={on.onUpdatePayload}
                            />
                        </span>
                    ) : null}
                    {containerInfo?.repeatTimes !== undefined ? (
                        <span className={HEADER_SLOT_CLASS}>
                            <RepeatTimesField block={block} onUpdatePayload={on.onUpdatePayload} />
                        </span>
                    ) : null}
                    {containerInfo?.repeatUntil !== undefined ? (
                        <span className={HEADER_SLOT_CLASS}>
                            <RepeatUntilChip
                                block={block}
                                scene={scene}
                                document={document}
                                onUpdatePayload={on.onUpdatePayload}
                            />
                        </span>
                    ) : null}
                    {namesSpeaker ? (
                        /*
                         * The nametag, in front of the words it introduces (gutter 规范 §2).
                         *
                         * It used to sit in a fixed-width column of its own, which held every row's
                         * text to one x — including the narration and directive rows that could never
                         * fill it, so the two widest kinds of row in a scene each carried a permanent
                         * void where a name would go. The paragraph rule is what made the column
                         * unnecessary: a run is named ONCE, so a scene is mostly continuations, all of
                         * which start on the one edge, and the name that opens a paragraph reads as
                         * the first words of it rather than as a label filed beside it.
                         */
                        <span className="flex min-h-[var(--nl-story-row-box)] shrink-0 items-center" style={textStyle}>
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
                        </span>
                    ) : null}
                    {editing && textSegment ? (
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
                            continuing={continuationRow}
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
                    {/* The lint mark is NOT part of the hover cluster: it is there to be noticed while
                        reading, so it keeps its own always-visible slot. The voice audition button
                        shares the slot but hover-reveals itself — it is an action, and voice *status*
                        is the voice table's job rather than a mark on every spoken row. */}
                    {/* Both trailing clusters hold the single-line box open and centre in it, like every
                        other cell in this flex. Without it they are 24px of buttons in an `items-start`
                        row: their centre line sits at 12px while the words centre at half the row box,
                        so the icons ride high by 2px in compact and 7px in comfortable — the looser the
                        density an author picks, the more crooked the row's own controls look. */}
                    {containerInfo ? null : (
                        <div className="ml-auto flex min-h-[var(--nl-story-row-box)] shrink-0 items-center gap-1">
                            {diagnostic ? <RowDiagnosticMark code={diagnostic.code} /> : null}
                            <StoryVoiceIndicator block={block} />
                        </div>
                    )}
                    <div
                        aria-hidden={!showRowActions}
                        className={[
                            "flex min-h-[var(--nl-story-row-box)] shrink-0 items-center gap-1 transition-opacity",
                            containerInfo ? "ml-auto" : "",
                            showRowActions ? "opacity-100" : "pointer-events-none opacity-0",
                            controlsOverArtwork ? "nl-on-media" : "",
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

/**
 * What an empty row being edited says it is for.
 *
 * A dialogue row with a real speaker says more than its kind: it names them, and it names the other
 * thing this line can become. Enter under a line of dialogue opens a row that is still that
 * character's — either more of their words, or something done to them — and "对话…" advertised only
 * the first half, leaving the second undiscoverable. See `startCharacterActionSlot`.
 *
 * `continuing` is the row's own place in the paragraph (`groupRole === "member"`), and it changes one
 * word: the row that OPENS a run starts the speaker talking, the ones under it carry on. Telling an
 * author to "continue" a conversation that has not begun is a small lie, and it is on the first row
 * of every character in the scene.
 */
function editorPlaceholder(
    block: StoryBlock,
    characters: Character[],
    trigger: string,
    continuing: boolean,
    t: ReturnType<typeof useTranslation>["t"],
): string {
    switch (getTextSegment(block)?.role) {
        case "dialogue": {
            // Only a real character: a bare speaker name has no record for those verbs to act on, so
            // offering them would be advertising a line that cannot resolve.
            const speaker = dialogueActionCharacter(block, characters);
            if (!speaker) {
                return t("story.rows.placeholderDialogue");
            }
            const params = { name: speaker.profile.getName(), trigger };
            return continuing
                ? t("story.rows.placeholderDialogueContinue", params)
                : t("story.rows.placeholderDialogueStart", params);
        }
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
    /** The row is a later line of a paragraph, not the one that opens it — see {@link editorPlaceholder}. */
    continuing: boolean;
}) {
    const { t } = useTranslation();
    // The placeholder advertises the action trigger, so it has to advertise the one THIS author
    // presses — the same "@"-or-"/" every other surface reads off the command-line context.
    const commandLine = useStoryCommandLineContext();
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
    // The inline expression chip names the look the author picked, through the same lookup the command
    // line reads — so the chip and a typed `/face` say the same word. See `storyAppearanceLabel`.
    const appearanceName = commandLine.appearanceName;
    const resolveAppearanceLabel = useMemo(
        () => (appearance: StoryAppearanceSelection) => storyAppearanceLabel(appearance, appearanceName),
        [appearanceName],
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
                placeholder={editorPlaceholder(props.block, props.characters, commandLine.trigger, props.continuing, t)}
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
                resolveAppearanceLabel={resolveAppearanceLabel}
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
    if (block.kind === "note" || block.kind === "invalid") {
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
                "flex h-6 shrink-0 cursor-default items-center gap-1 rounded-md px-1.5 text-2xs text-fg-muted transition-opacity hover:bg-fill hover:text-primary group-hover:pointer-events-auto group-hover:opacity-100",
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
 * The gap between the gutter's mark column and the row's words, in px (gutter 规范 §6).
 *
 * 12 rather than the 8 the three-column layout used. The old row put two chrome columns in front of
 * the text, so a wide boundary between each pair pushed the words a long way in and the gaps were
 * squeezed to pay for it. With one column there, the boundary can be the width the spec asks for —
 * and it needs to be: the mark is the only thing separating the line numbers from the prose, and at
 * 8px on both sides it read as part of whichever it happened to be nearer.
 *
 * The nesting guides are positioned outside that flex, so they add it back to find where a level's
 * content begins.
 */
const ROW_GAP_PX = 12;

/**
 * The content column's own top padding (`py-1`), in px.
 *
 * The nesting connector is positioned on the ROW, which knows nothing of the column's padding, so a
 * header has to add it back to find the bottom edge of its own mark. Re-exported from the mark module
 * rather than declared twice: the continuation rule cancels this exact padding to reach the row's
 * edges, so the two uses have to be the same number by construction.
 */
const ROW_CONTENT_PAD_PX = STORY_ROW_CONTENT_PAD_PX;

/**
 * How far a connector's last segment turns right, in px.
 *
 * Short on purpose. Running it out to the name column's far edge was tried: it made the turn a
 * statement, and a line whose job is to say "these rows belong together" should not be making
 * statements at the end of every run and every block on the screen.
 */
const CONNECTOR_ELBOW_PX = 10;

/**
 * The nesting connector's tone.
 *
 * One hairline at one weight, and it now has exactly one job: the container a row sits inside. The
 * same-speaker run it used to also draw is the gutter's continuation rule, which lives in the mark
 * column and is coloured by the voice it belongs to — a paragraph's line says WHOSE, and a block's
 * line says WHERE, so the one place they were drawn by the same component is the one thing that had
 * to change.
 *
 * Thin and dim by intent: it is not load-bearing. When it was raised to 2px at full `fg-subtle` it
 * was the only thing telling a continuation from a line of narration, so it had a contrast floor to
 * meet. Nothing depends on it for that now, and a line loud enough to be an answer is loud enough to
 * be noise once it isn't.
 */
const CONNECTOR_FILL = "bg-fg-subtle/50";
const CONNECTOR_FILL_ACTIVE = "bg-primary/70";
// Kept apart from the fill on purpose: the elbow is drawn from borders around an EMPTY box, so handing
// it a background class as well — which one combined token quietly did — fills that box in and turns a
// hairline corner into a 10px slab.
const CONNECTOR_EDGE = "border-fg-subtle/50";
const CONNECTOR_EDGE_ACTIVE = "border-primary/70";

/**
 * One segment of the nesting connector: a hairline down the row, stopping at the text's centre line
 * when the branch ends here, and turning right when this is also the deepest level that ends.
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
 * One nesting level's indent: the mark column plus the gap after it, so a child's mark lands exactly
 * where its parent's WORDS start.
 *
 * This is the step the old three-column layout could never quite reach. Back then the content offset
 * was plate + name column + two gaps, and indenting by the whole of it pushed a nested directive's
 * words ~250px in — because an action row carried a speaker column it could never fill, so at every
 * level a void stacked on top of the indent. The compromise was a third of that: near the reading
 * column, but landing on nothing the eye already knew.
 *
 * With the name column gone the honest step and the readable step are the same number, and a block's
 * children start on the one x their header's own words start on.
 */
const ROW_INDENT_STEP = `(var(--nl-story-mark,26px) + ${ROW_GAP_PX}px)`;

/** The indent for content `levels` deep, as a CSS length. */
function rowIndent(levels: number): string {
    return `calc(${ROW_INDENT_STEP} * ${levels})`;
}


/**
 * The nesting connector: one line per ancestor level, hanging from that ancestor's mark, and turning
 * right into the last row of the block.
 *
 * It used to be a flat `bg-edge` hairline running the full height of every row it passed — no start
 * (it began at the first child's top edge, nowhere near the header that owns the block) and no end (it
 * ran off the bottom of the last child into whatever followed). Both ends mean something now.
 *
 * `opensBlock` is the header's own half: an expanded container drops the line out from under its own
 * mark, so the block starts where the row that names it does.
 */
function RowNesting({ depth, nextDepth, opensBlock, stopAt, markBottom, highlight }: {
    depth: number;
    nextDepth: number;
    opensBlock: boolean;
    /** Y of the row's text centre line: where a branch that ends here stops. */
    stopAt: number;
    /** Y of the bottom of this row's own mark: where a block's line leaves its header. */
    markBottom: number;
    highlight: boolean;
}) {
    if (depth <= 0 && !opensBlock) {
        return null;
    }
    // Down the centre of the ancestor's mark at that level.
    const at = (level: number) => `calc(${ROW_INDENT_STEP} * ${level} + (var(--nl-story-mark,26px) / 2))`;
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
                <ConnectorSegment left={at(depth)} top={markBottom} ends={false} elbow={false} stopAt={stopAt} highlight={highlight} />
            ) : null}
        </>
    );
}

/*
 * An in-group `/face` used to render as a compacted "differential" — the appearance name alone, in
 * muted 2xs type, with the verb and the character dropped. It is gone, and the row reads as the
 * command it is: `@表情 Inko 微笑`, the same line the author typed and the same line every other
 * character verb in the paragraph shows.
 *
 * What made it wrong was never the compaction alone but the two things it cost. It printed the
 * STORED value, which for both appearance kinds is an id, so a paragraph carried `p8edj8l` in the
 * middle of it. And it made `/face` the one verb in the vocabulary that a reader could not read back:
 * the rows above and below it said `@移动 Inko 左` and `@皮肤 Inko 冬装` while it said a bare noun.
 * The paragraph rail already says "this row is still Inko's" — that was the whole job the compaction
 * was hired for, and the rail does it without hiding what the row does.
 */

/**
 * The container header's label pill is gone: it was a bordered, tinted, small-caps chip — a fourth
 * icon form on a screen that already had three — and it started at the header's own left edge, which
 * is one column further left than the text of every row inside the block. A block that does not line
 * up with itself is the worst offender in a list read top-down.
 *
 * A header now renders exactly like the directives it contains: it is machinery (§1), so it takes the
 * same tint and the same bare stroke glyph, then its words on the body edge.
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

/**
 * Editable stop-condition chip on a `/repeat until` header - the counted loop's stepper, for the
 * conditional form.
 *
 * Deliberately the same popover the branch chip opens rather than a chip of its own: an author who
 * has written one condition has written all of them, and a second condition editor would be a second
 * set of rules to learn for the same object.
 */
function RepeatUntilChip(props: {
    block: StoryBlock;
    scene: StoryScene;
    document: StoryDocument;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    const [anchor, setAnchor] = useState<{ top: number; left: number; bottom: number } | null>(null);
    const block = props.block;
    if (block.kind !== "control" || block.payload.control !== "repeat" || block.payload.until === undefined) {
        return null;
    }
    const payload = block.payload;
    return (
        <>
            <button
                type="button"
                className="min-w-0 max-w-[240px] truncate rounded-md border border-edge bg-fill-subtle px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-primary/50 hover:text-fg"
                onClick={event => {
                    event.stopPropagation();
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                    setAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
                }}
                onMouseDown={event => event.stopPropagation()}
            >
                {conditionSummary(payload.until, props.scene, props.document, t)}
            </button>
            {anchor ? (
                <ConditionPopover
                    anchor={anchor}
                    document={props.document}
                    sceneId={props.scene.id}
                    value={payload.until}
                    // Both writers coalesce: dropping `until` would silently turn this back into a
                    // counted loop, which is a different construct. Emptying the condition keeps the
                    // form; the inspector's loop-mode select is the one place that switches it.
                    onChange={until => props.onUpdatePayload({ ...payload, until: until ?? EMPTY_EXPRESSION_CONDITION })}
                    onClear={() => {
                        props.onUpdatePayload({ ...payload, until: EMPTY_EXPRESSION_CONDITION });
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

/**
 * A container header's leading word.
 *
 * Two shapes, and which one a header gets is not a style choice — it is whether a line wrote the row.
 *
 *  - A container an author can type (`/if` `/repeat` `/until` `/parallel` `/race` `/sequence` `/nvl`
 *    `/menu`) prints as that line: the trigger, then the command's own name, through the same
 *    renderer and the same four-role palette every other directive row uses. It was the last thing in
 *    the list still printing a bare word while the rows around it printed `@赋值` / `@镜头`, and the
 *    missing head made a block header read as a caption rather than as the instruction it is.
 *  - A header no line produces — the condition BRANCHES and a choice OPTION — keeps the prose style,
 *    the same italic muted reading `BlockOverview` gives every command-less row. `@否则` would be a
 *    word the parser cannot take back, and the editor prints no line an author could not type.
 *
 * The word is the COMMAND's, not the header pill's: `story.command.<id>.label` is the vocabulary the
 * parser accepts and the menu teaches, so a header that says 直到 says the word `/until` answers to.
 * The pill stays what the property panel's breadcrumb reads — there it names the structure you are
 * standing in, which is a different question from what to type.
 */
/**
 * The header word's box: `shrink-0`, and deliberately NOT `truncate`.
 *
 * `shrink-0` because a header's word is followed by its own editors — the condition chip, the repeat
 * count — and must not give up room to them, so the box is exactly as wide as the word.
 *
 * Which is precisely why it cannot clip. `truncate` brings `overflow: hidden` along, and a max-content
 * box has nothing to truncate — the only thing that ever reached the clip was the ITALIC OVERHANG:
 * a slanted glyph's ink leans past the advance width the box is measured from, so 否则 lost the top of
 * 则's 刂 to a diagonal shave, and only on the last character, which reads as a font bug rather than
 * as a clip. `whitespace-nowrap` keeps the one part of `truncate` this box actually wants.
 */
const HEADER_WORD_CLASS = "flex min-h-[var(--nl-story-row-box)] shrink-0 items-center whitespace-nowrap text-sm";

/**
 * The slot a container header's inline editors sit in: the condition chip, the repeat count, the stop
 * condition, the engine-mode badge.
 *
 * It exists to put them on the same optical line as the word in front of them. The row is
 * `items-start` for a reason that has nothing to do with these — a wrapped paragraph must keep its
 * gutter mark level with the FIRST line rather than drifting to the middle of three — but the side
 * effect is that every short control in the row hangs from the row's top edge. A 22px chip beside a
 * 32px header word therefore sat 5px high, which on `@如果 [认识Hya]` reads as the chip floating off
 * the text. Giving each control the row-box height and centring inside it is the same fix (and the
 * same three classes) the nametag already uses, and it stays true when the row wraps: the box is one
 * line tall, so "centred" still means centred on the first line.
 */
const HEADER_SLOT_CLASS = "flex min-h-[var(--nl-story-row-box)] shrink-0 items-center";

function ContainerHeaderWord({ info, textStyle }: { info: StoryContainerHeaderInfo; textStyle?: CSSProperties }) {
    const { trigger } = useStoryCommandLineContext();
    // Subscribed to, not called: `localizedCommandToken` reads the command locale imperatively, so
    // without this a language switch leaves headers in the old vocabulary (the note on BlockOverview).
    useCommandTranslation();
    const def = info.commandId ? getDefById(info.commandId) : null;
    if (!def) {
        return (
            <span className={HEADER_WORD_CLASS + " italic text-fg-muted"} style={textStyle}>
                {info.pill}
            </span>
        );
    }
    return (
        // `opacity-80` is the committed-row dimming — same skeleton as the live field, one step back.
        <span className={HEADER_WORD_CLASS + " opacity-80"} style={textStyle}>
            <StoryCommandLineText source={`${ACTION_TRIGGER}${localizedCommandToken(def)}`} trigger={trigger} />
        </span>
    );
}

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

/**
 * What the argument menu offers at this caret: the candidates, whether the panel opens at all, and
 * whether anything starts out highlighted.
 *
 * Pure and locale-free, so the admission rule can be pinned by a test without mounting a row — the
 * component only adds labels and icons on top of it. It is a named function rather than the three
 * inline conditions it replaces, because inline conditions are exactly how the `expression` arm went
 * missing: `getCommandCursor` has answered `expression` for every `/set`, `/if` and `/until`
 * right-hand side since it was written, the model has always had candidates ready for it (variables,
 * blueprints, `visited(` scenes, `picked(` options), and the gates listed only `positional` /
 * `paramValue` / `paramName`. The result was a menu that had never once rendered in an expression
 * slot — the model was right and had no way out.
 *
 * The open rule, unchanged: an empty list still opens at a value position where the author typed
 * something a param *could* have matched — that is the "no matches" the speaker picker also shows,
 * and it is the honest answer to "does this name exist?". It stays shut for a param with nothing to
 * enumerate (a duration, a colour), where "no matches" would be nonsense, and at a `k=` position,
 * where an empty list means every param is already given and there is nothing left to say.
 */
export function argMenuOffer(
    cursor: StoryCommandCursor,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>>,
): { open: boolean; candidates: readonly StoryCommandCandidate[]; autoHighlight: boolean } {
    // A value position completes to a value: a positional, a `k=` value, or the identifier fragment
    // under the caret inside a greedy expression. All three share the open rule above; `paramName` is
    // the one that does not.
    const valuePosition = cursor.kind === "positional" || cursor.kind === "paramValue" || cursor.kind === "expression";
    if (!valuePosition && cursor.kind !== "paramName") {
        return { open: false, candidates: [], autoHighlight: false };
    }
    const candidates = getCommandCandidates(cursor, context, resolved);
    const open = valuePosition
        ? candidates.length > 0 || (cursor.query.length > 0 && hasCandidateSource(cursor.param, context, resolved))
        : candidates.length > 0;
    // The highlight stays `defaultHighlights`'s call — one rule, not a second one invented here. Worth
    // restating what it decides for the arm this function has just let through, because it will read
    // like an omission to whoever sees the menu next: an expression NEVER default-highlights, and that
    // is the author's ruling rather than an oversight. In an expression the author is writing, not
    // picking, so Enter has to keep meaning "commit this line" and ←/→ have to keep meaning "move the
    // caret" — a menu that opened with `gold` lit would make `/set gold gold + 1` + Enter insert a
    // variable instead of submitting. ↑/↓ create a highlight when the author wants one (the same key
    // every other chooser here answers to), and Tab still takes the first candidate.
    return { open, candidates, autoHighlight: defaultHighlights(cursor, candidates) };
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
    /**
     * The speaker this slot belongs to, when it opened on top of their line (see
     * `startCharacterActionSlot`). Read as a plain name rather than as the scope object, so a fresh
     * slot object on every keystroke cannot invalidate the lists memoized against it.
     */
    const scopeName = props.mode.slot.characterScope?.name ?? null;
    const actionOptions = useMemo<PaletteActionCommand[]>(
        () => {
            const all = [
                // The typing/filter tier lists one entry per spec — the ranked flat list is the right
                // shape while filtering, so a verb appears once even though it files under many subjects.
                ...specPaletteCommands().map(command => localizeSpecCommand(command, ct)),
                // A plugin action carries the label its own language pack already resolved.
                ...pluginCommands,
            ];
            return searchActionCommands(scopeName === null ? all : characterScopedActions(all), chooserQuery);
        },
        [chooserQuery, ct, pluginCommands, scopeName],
    );
    // The browse is the sidebar's projection, not a second catalogue: same `accepts` classification
    // (WI-1). Handed over undeduped, because the menu's category column needs both readings of it —
    // 全部 collapses to one row per command (a verb repeated under six subjects with the same sentence
    // each time reads as six commands, not as one that reaches six places), while a chosen category
    // wants the full filing, where `/show` under 图片 is the answer rather than a repeat.
    const sidebarGroups = useMemo(
        () => {
            const groups = buildSpecSidebarGroups(pluginCommands, command => localizeSpecCommand(command, ct));
            return scopeName === null ? groups : characterScopedSidebarGroups(groups);
        },
        [ct, pluginCommands, scopeName],
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
    // The whole menu decision — what to show, whether to open, what (if anything) starts highlighted.
    // `ct` is a dependency for the same reason it is one above: the candidates are spelled in the
    // command locale (an enum offers the word it displays), so a locale switch has to re-offer them.
    const argOffer = useMemo(
        () => argMenuOffer(cursor, props.commandContext, resolvedArgs),
        [ct, cursor, props.commandContext, resolvedArgs],
    );
    const argItems = useMemo<StoryCandidateItem[]>(() => {
        return argOffer.candidates.map((candidate, index) => {
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
                // What the candidate IS, decided where it was produced — the arm of the grammar that
                // listed it knows, and the caret alone does not: a `/show |` slot lists characters and
                // stage objects together, and reading the mark off the param made every row in it wear
                // the first branch's glyph.
                mark: candidate.mark,
                tag: candidate.free ? t("story.rows.tempSpeaker") : undefined,
                ...(candidate.free ? { free: true as const } : {}),
            };
        });
    }, [argOffer, ct, t]);
    // The candidates decide the highlight along with the cursor: an untyped slot, a slot whose best
    // offer is the author's own text, and every expression slot all have to leave Enter meaning
    // "submit". See `defaultHighlights`, and `argMenuOffer` for why the expression case is deliberate.
    const argMenu = useStoryCandidateMenuState(argItems, argOffer.autoHighlight);

    // The argument menu owns the slot whenever the caret is past the command name and `argMenuOffer`
    // says there is something to show.
    const argMenuOpen = chooser === "action" && argOffer.open;
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
            //
            // A scoped slot fills the subject in too: the menu only offered this character's verbs, so
            // the name is not a question left to ask - and writing it (rather than an id) leaves a line
            // the author could have typed themselves, caret already on the next slot.
            const lead = scopeName === null ? "" : characterScopeLead(def, scopeName);
            applyCompletion(`${trigger}${localizedCommandToken(def)} ${lead}`, { start: 0, end: value.length });
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
                    markBottom={ROW_CONTENT_PAD_PX}
                    highlight={false}
                />
                <div style={{ paddingLeft: rowIndent(props.depth ?? 0) }}>
                <div className="flex min-h-[var(--nl-story-row-box)] items-center" style={{ gap: ROW_GAP_PX }}>
                {/* The gutter's slot, held open and empty: a line being typed has no speaker yet, and
                    the whole point of the column is that the words below it never move. */}
                <span className="w-[var(--nl-story-mark,26px)] shrink-0" aria-hidden />
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
                    // A scoped slot names what it is for instead: narration and "#" are still typeable
                    // there, but neither is why the author pressed the trigger on a speaker's line.
                    placeholder={props.mode.confirmation
                        ? ""
                        : scopeName !== null
                            ? t("story.rows.insertPlaceholderCharacter", { name: scopeName })
                            : t("story.rows.insertPlaceholder", { trigger: props.slashAtAlias ? "@" : "/" })}
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
                        scopeLabel={scopeName === null ? undefined : t("story.actionCreator.scopedTo", { name: scopeName })}
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
                        characters={props.characters}
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
    // The glyph is the COMMAND's, the colour is the SECTION's (the sidebar's rule, shared here): the
    // icon says the verb, the hue says the subject it is filed under.
    const Icon = command.icon;
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
    /**
     * The menu is narrowed to one subject and this line says which — set only for a character-scoped
     * slot. It replaces the category column outright: eight chips with seven of them dimmed reads as
     * "most of this is broken", where one line reads as "this list is about Alice", which is the true
     * statement. Nothing is lost with it — the column is a pointer-only filter, and there is nothing
     * left to filter.
     */
    scopeLabel?: string;
}) {
    const { t } = useTranslation();
    // Category names are the subject vocabulary the whole command surface is filed under, so they
    // follow the command language; the menu's own chrome ("no actions", the key strip) does not.
    const { t: ct } = useCommandTranslation();
    const listRef = useRef<HTMLDivElement | null>(null);
    // The scope header wears 角色's own glyph and hue — the same pair its category chip and every
    // committed character row wear, so a narrowed menu still says which subject it is narrowed to.
    const scopeCategory = getCommandCategory("character");
    const ScopeIcon = scopeCategory.icon;

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
                            {/* A scoped menu has one section, and the panel's own header already
                                named it — a second "角色" under it would only say it twice. */}
                            {props.scopeLabel ? null : (
                            <div className="flex items-center gap-1.5 px-2 pb-1 text-2xs font-medium tracking-wide text-fg-subtle">
                                <Icon className="h-3 w-3 shrink-0" style={{ color: entry.group.iconColor }} />
                                <span>{ct(commandCategoryLabelKey(entry.group.id))}</span>
                            </div>
                            )}
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
            {props.scopeLabel ? (
                // Scoped: one column under one line. Same 288px box, so a menu that opens here and a
                // menu that opens on a blank slot are the same object in two states rather than two
                // panels of different sizes appearing at the same anchor.
                <div className="flex h-72 flex-col">
                    <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2 text-2xs font-medium tracking-wide text-fg-subtle">
                        <ScopeIcon className="h-3 w-3 shrink-0" style={{ color: scopeCategory.iconColor }} />
                        <span className="truncate">{props.scopeLabel}</span>
                    </div>
                    <div ref={listRef} className="nl-no-scrollbar min-w-0 flex-1 overflow-auto p-1 pt-2">
                        {rows}
                    </div>
                </div>
            ) : (
            /* A fixed height, not a cap. Under `max-h`, the box took the taller column's height, and
                the category column is 284px against the cap's 288 — so a category whose commands did
                not fill the panel (镜头 has one, 工具 three) shrank the whole menu by those 4px and
                grew it back on the way out. Switching category is the one thing this column exists
                for, and it flinched every time. Same size whatever is open; only the right column
                scrolls. */
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
            )}
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
                            {/* A real character shows their face, exactly as the argument menu does in
                                this same slot — the two are meant to read as one menu following the
                                caret. A temp speaker is a name with nobody behind it: it keeps the
                                outline glyph and a tag, so picking one is never mistaken for picking a
                                character. */}
                            <StoryCandidateSpeakerMark character={candidate.kind === "temp" ? null : candidate.character} />
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
/**
 * The identity a nametag paints itself with, from the same two fields the gutter reads.
 *
 * Both branches call the resolvers the gutter calls rather than deriving anything of their own: the
 * nametag and the mark beside it have to be the same colour for the same speaker (§3.3), and one
 * function is the only thing that guarantees it.
 */
function rowSpeakerIdentityFor(characters: Character[], characterId: string | undefined, speakerName: string | undefined): StorySpeakerIdentity | null {
    if (characterId) {
        return characterIdentity(characterId, characters);
    }
    return speakerName ? characterSpeakerIdentity(speakerName, { hasPortrait: false }) : null;
}

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
     * The nametag opens a paragraph: at the body type size, with its leading padding pulled back out
     * by a negative margin, so the hover chip keeps its 4px but the first *glyph* lands exactly on the
     * body edge — the name reads as the first words of the line rather than as a chip in front of them.
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
    /**
     * The nametag's colour: the speaker's own, and the SAME one their gutter mark wears (§3.3).
     *
     * That identity is the rule the whole scheme rests on — one character, one colour, everywhere it
     * appears: the disc, the name, the paragraph's continuation rule, and the inline chip on a command
     * line that acts on them. The version this replaces read the author's raw hex here while the
     * gutter derived its own tint elsewhere, so the same character could be one colour in the margin
     * and another in the text.
     *
     * A bare temp speaker takes a hue from its name like anyone else. A selected row yields the colour
     * entirely: the selection highlight owns the row, and "you are here" outranks "this is who".
     */
    const speakerIdentity = props.suppressColor
        ? null
        : rowSpeakerIdentityFor(props.characters, props.characterId, props.speakerName);
    const speakerPaint = speakerIdentity ? storySpeakerPaint(speakerIdentity.paint) : null;
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
                        // The speaker's own colour, through the one seam the gutter's marks use — so
                        // the name and the face beside it cannot disagree about whose line this is.
                        speakerPaint ? speakerPaint.className : "",
                        unassigned ? "italic text-fg-subtle hover:text-primary" : speakerPaint ? "" : "text-fg-muted",
                        props.className ?? "",
                    ].join(" ")}
                    style={speakerPaint && !unassigned
                        ? { ...props.style, ...speakerPaint.style, color: "var(--nl-speaker-name)" }
                        : props.style}
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
