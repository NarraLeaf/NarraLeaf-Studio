import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject, MouseEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, ChevronRight, GanttChart, GripVertical, Hash, Image, List, Music, Play, Plus, Route, Trash2, TriangleAlert, UserRoundPlus, Variable, Video } from "lucide-react";
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
import type { PaletteActionCommand } from "./storyActionCommands";
import {
    commandCategoryLabelKey,
    getCommandCategory,
    getCommandGroup,
    subjectGroupId,
} from "./storyCommandCategories";
import { searchActionCommands } from "./storyCommandSearch";
import { localizeSpecCommand, specPaletteCommands } from "./commands/specPalette";
import { browseMenuStops, buildSpecSidebarGroups, dedupeToPrimarySubject, type StoryCommandMenuStop, type StoryCommandSidebarGroup } from "./commands/specSidebar";
import { useStoryPluginActionCommands } from "./useStoryPluginActionCommands";
import { paramTypes } from "./storyCommandGrammar";
import { getCommandDef } from "./commands/registry";
import { completionFor, defaultHighlights, getCommandCursor, type StoryCommandCursor } from "./storyCommandCursor";
import { getCommandCandidates, hasCandidateSource, type StoryCommandCandidate } from "./storyCommandCandidates";
import { parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "./storyCommandResolution";
import { StoryCommandCandidateMenu, useStoryCandidateMenuState, type StoryCandidateItem } from "./StoryCommandCandidateMenu";
import { RichTextInput, type ActiveMarks, type EventClickInfo, type InterpolationClickInfo, type PauseClickInfo, type RichTextInputHandle } from "./RichTextInput";
import { RichTextToolbar } from "./RichTextToolbar";
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
import { BlockOverview, getQuickParams, QuickParamsInline, type QuickParam } from "./storyQuickParams";
import { lensTrackRendersBar, type StoryLensRowTrack } from "./storyStagingLens";
import { actionTrigger, ACTION_TRIGGER, insertChooserType, toCanonicalCommandLine } from "./commandTrigger";
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
    /** This row is a parallel/race container currently showing its staging lens (M7). */
    lensActive: boolean;
    /** Reading density (U1): the attribution rail and the portrait column size themselves from it. */
    density: StoryEditorDensity;
}) {
    const { t } = useTranslation();
    const { row, scene, document, characters, selected, active, collapsed, editing, textInputRef } = props;
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
        onCommitTextEdit: actions.commitTextEdit,
        onExitTextEdit: actions.exitTextEdit,
        onContinue: actions.continueRow,
        onArrowOut: actions.arrowOut,
        onGoalColumnInvalidated: actions.goalColumnInvalidated,
        onBackspaceAtEmptyStart: actions.backspaceAtEmptyStart,
        onUndoBeyondRow: actions.undoBeyondRow,
        onRedoBeyondRow: actions.redoBeyondRow,
        onOpenInspector: () => actions.openInspector(blockId),
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
        onToggleLens: () => actions.toggleLens(blockId),
    };

    const block = row.block;
    const container = isContainerBlock(block);
    const containerInfo = container ? getContainerHeaderInfo(block) : null;
    // Staging lens (M7). `lensTrack` marks a direct child of a lensed container — it renders as a
    // bar-timeline track. `lensMode` marks a parallel/race container header itself (all/allAsync/any),
    // which carries the mode badge (WI-3) and the list⇄lens toggle.
    const lensTrack = row.lensTrack;
    // Only a staging track swaps its content column for a bar. A prose child (narration / dialogue /
    // note — reachable through the lens's own tail "+") stays on the ordinary row path, because that is
    // where the in-place text editor, the voice indicator and the row actions live: swapping the whole
    // column would leave a row that click / double-click / Enter put into text-edit mode with no editor
    // to type into (interaction model §"Editing in place"; WI-2 "Enter/Escape 照常").
    const lensBarTrack = lensTrack && lensTrackRendersBar(lensTrack) ? lensTrack : null;
    const lensMode: "all" | "allAsync" | "any" | null = block.kind === "control" && block.payload.control === "race"
        ? "any"
        : block.kind === "control" && block.payload.control === "parallel"
            ? (block.payload.mode === "allAsync" ? "allAsync" : "all")
            : null;
    // A lensed container is inherently expanded (its children are the tracks), so its collapse chevron
    // would be a no-op — hide it while the lens is on.
    const canFold = block.childrenIds.length > 0 && canAcceptChildren(block) && !(lensMode && props.lensActive);
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
     * The group's attribution rail (U1 WI-1), drawn on the ROW rather than inside the badge slot.
     *
     * It used to be a 1px hairline inside a 24px box: `rgba(255,255,255,0.1)` at rest, i.e. 1.27:1 on
     * the editor's backdrop, which is invisible in the literal sense, and it only lit up on hover. Two
     * same-speaker continuations and a narration line therefore rendered identically — grouping was
     * subtracting information. On the row it can span the full height, so consecutive members join
     * into one unbroken line back to the speaker, and it is `fg-subtle` (4.1:1) at rest.
     */
    const groupRail = row.groupRole === "member" || row.groupContinues
        ? {
            // Centre of the portrait column, plus this row's nesting indent and the two chrome columns.
            left: `calc(var(--nl-story-gutter) + 28px + ${row.depth * RAIL_STEP + STORY_DENSITY_METRICS[props.density].avatar / 2 - 1}px)`,
            // A head hands the rail off from under its own portrait; a member carries it edge to edge.
            top: row.groupRole === "member" ? 0 : ROW_CONTENT_PAD_PX + STORY_DENSITY_METRICS[props.density].avatar,
        }
        : null;
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
    const reduceMotion = useReduceMotion();
    const showRowActions = hovered || active;
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
        id: row.block.id,
        // Reduce-motion means the sort animation is off at the source, not merely overridden in CSS:
        // dnd-kit writes this transition as an inline style, which the stylesheet's blanket rule
        // cannot reach.
        transition: reduceMotion ? null : undefined,
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
                // Height comes from the density's single-line box plus the content column's `py-1`, so
                // every column can centre inside the same box (see STORY_DENSITY_METRICS). `items-start`
                // is load-bearing: a wrapped line keeps its first line aligned with the badge.
                "group relative grid min-h-[calc(var(--nl-story-row-box)+0.5rem)] grid-cols-[var(--nl-story-gutter)_28px_1fr] items-start border-l-2 pr-3",
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
                <span
                    aria-hidden
                    className={[
                        "pointer-events-none absolute bottom-0 w-0.5 rounded-full",
                        selected || active ? "bg-primary" : "bg-fg-subtle",
                    ].join(" ")}
                    style={groupRail}
                />
            ) : null}
            <div className="relative flex h-full items-start justify-end pt-1 text-xs tabular-nums text-fg-subtle">
                <div className="flex min-h-[var(--nl-story-row-box)] items-center gap-1">
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
                    <span>{row.lineNumber}</span>
                </div>
            </div>
            {/* The handle centres inside the SAME single-line box the text and the line number use,
                not over the whole row: on a wrapped row, centring over the row would drift it below
                the line it grabs. */}
            <div className="relative flex min-h-[calc(var(--nl-story-row-box)+0.25rem)] items-center justify-center pt-1">
                <div
                    ref={setActivatorNodeRef}
                    {...attributes}
                    {...listeners}
                    role="button"
                    tabIndex={0}
                    aria-label={t("story.rows.dragRow")}
                    title={t("story.rows.dragRow")}
                    // Sized to the (narrowed) column so the invisible-but-clickable target never
                    // overhangs into the badge beside it — an opacity-0 button still takes clicks.
                    className="flex h-7 w-7 touch-none select-none items-center justify-center rounded-md text-fg-subtle opacity-0 transition-colors hover:cursor-grab hover:text-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 group-hover:opacity-100"
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                >
                    <GripVertical className="pointer-events-none h-4 w-4" />
                </div>
            </div>
            <div className="relative min-w-0 py-1">
                <RailGuides depth={row.depth} highlight={selected || active} />
                <div style={{ paddingLeft: row.depth * RAIL_STEP }}>
                {lensBarTrack ? (
                    <LensTrackContent
                        row={row}
                        scene={scene}
                        document={document}
                        characters={characters}
                        commandContext={props.commandContext}
                        tempSpeakers={props.tempSpeakers}
                        onSetSpeaker={on.onSetSpeaker}
                        onCreateCharacter={on.onCreateCharacter}
                        onSetDialogueCharacter={on.onSetDialogueCharacter}
                        onUpdatePayload={on.onUpdatePayload}
                        onAddInside={on.onAddInside}
                        onInsertAfter={on.onInsertAfter}
                        onDeleteRow={on.onDeleteRow}
                        active={active}
                    />
                ) : (
                <>
                <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-center gap-2">
                    {containerInfo ? (
                        <>
                            <ContainerPill info={containerInfo} />
                            {lensMode ? <ContainerModeBadge mode={lensMode} /> : null}
                        </>
                    ) : expressionMember ? null : (
                        // The gutter's last column: one fixed width for every row at a given density,
                        // so the portrait, the category plate and the empty slot a continuation leaves
                        // for the rail all reserve the same space. A category plate stays 28px and
                        // sits at the column's leading edge rather than growing into it (U1).
                        <span className="flex w-[var(--nl-story-avatar,28px)] shrink-0 items-center" aria-hidden={dialogueMember || hideBadge}>
                            {dialogueMember || hideBadge ? null : (
                                <BlockBadge block={block} characters={characters} appearance={row.appearance} portrait={isDialogue} />
                            )}
                        </span>
                    )}
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
                            tempSpeakers={props.tempSpeakers}
                            onSetSpeaker={on.onSetSpeaker}
                            onCreateCharacter={on.onCreateCharacter}
                            document={document}
                            characters={characters}
                            onSetDialogueCharacter={on.onSetDialogueCharacter}
                            hideSpeaker={dialogueMember}
                            suppressSpeakerColor={selected}
                        />
                    ) : textSegment || !containerInfo ? (
                        <BlockPreview
                            block={block}
                            scene={scene}
                            commandContext={props.commandContext}
                            tempSpeakers={props.tempSpeakers}
                            onSetSpeaker={on.onSetSpeaker}
                            onCreateCharacter={on.onCreateCharacter}
                            document={document}
                            characters={characters}
                            onSetDialogueCharacter={on.onSetDialogueCharacter}
                            hideSpeaker={dialogueMember}
                            suppressSpeakerColor={selected}
                            onUpdatePayload={on.onUpdatePayload}
                        />
                    ) : null}
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                        {containerInfo ? (
                            <>
                                {lensMode ? <LensToggle active={props.lensActive} onToggle={on.onToggleLens} /> : null}
                                <ContainerHeaderAdd info={containerInfo} onAdd={() => on.onAddInside(block.id)} />
                            </>
                        ) : (
                            <>
                                {dialogueHead && showRowActions ? (
                                    <GroupHeadPositionControl position={row.appearance?.position} active={active} onSetPosition={on.onSetPosition} />
                                ) : null}
                                {diagnostic ? <RowDiagnosticMark code={diagnostic.code} /> : null}
                                <StoryVoiceIndicator block={block} />
                                {showRowActions ? (
                                    <RowActions onInsertAfter={on.onInsertAfter} onDelete={on.onDeleteRow} active={active} />
                                ) : null}
                            </>
                        )}
                        {showRowActions ? (
                            <RowPlayAction block={block} active={active} onPlay={() => on.onPlayFromRow(block.id)} />
                        ) : null}
                    </div>
                </div>
                {containerInfo ? (
                    <ContainerFooter
                        block={block}
                        info={containerInfo}
                        onAddInside={() => on.onAddInside(block.id)}
                        onAddBranch={branch => on.onAddBranch(block.id, branch)}
                    />
                ) : null}
                {/* A prose track on the ordinary path still carries the lens's tail "+" when it is the
                    container's last child — the affordance belongs to the lens, not to the bar. */}
                {lensTrack?.segment.isLast && block.parentId ? (
                    <LensTailAdd onAdd={() => on.onAddInside(block.parentId as StoryBlockId)} />
                ) : null}
                </>
                )}
                </div>
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
            props.onCommitTextEdit();
        }, 0);
    };

    return (
        <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <RichTextToolbar editor={props.editorRef} anchorRef={containerRef} commitGuard={commitGuardRef} active={activeMarks} hasVariables={variableOptions.scene.length + variableOptions.saved.length + variableOptions.persistent.length > 0} canInsertEvent={Boolean(dialoguePayload?.characterId)} onInsertEvent={insertEvent} />
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
                // A group member needs no indent of its own: the row holds the portrait column open
                // for it, so read and edit start at the same x and entering edit never jumps.
                className="min-h-[20px] flex-1 whitespace-pre-wrap break-words bg-transparent text-fg outline-none empty:before:italic empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]"
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
                three times the width while saying what the glyph and its tooltip already say. The
                labels stay as `aria-label`, so the accessible names did not change with the look. */}
            <button
                type="button"
                tabIndex={-1}
                title={t("story.rows.insertTitle", { keys: insertKeys })}
                aria-label={t("story.rows.insert")}
                className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-primary"
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
                title={t("story.rows.deleteTitle", { keys: deleteKeys })}
                aria-label={t("story.rows.delete")}
                className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-danger/10 hover:text-danger"
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
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: Event) => {
            if (!anchorRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("mousedown", onPointerDown, true);
        return () => window.removeEventListener("mousedown", onPointerDown, true);
    }, [open]);

    const currentValue = props.position ?? "center";
    const CurrentIcon = (STAGE_PLACEMENTS.find(placement => placement.value === currentValue) ?? STAGE_PLACEMENTS[1]).icon;

    return (
        <div ref={anchorRef} className="relative">
            <button
                type="button"
                tabIndex={-1}
                title={t("story.position.label")}
                aria-label={t("story.position.label")}
                className={[
                    "rounded-md p-1 transition-colors hover:bg-fill hover:text-primary",
                    open || props.active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    open ? "bg-fill text-primary" : "text-fg-muted",
                ].join(" ")}
                onClick={event => {
                    event.stopPropagation();
                    setOpen(value => !value);
                }}
            >
                <CurrentIcon className="h-4 w-4" />
            </button>
            {open ? (
                <div
                    className="absolute right-0 top-full z-50 mt-1 flex gap-0.5 rounded-lg border border-edge bg-surface-raised p-1 shadow-xl"
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
                                    setOpen(false);
                                }}
                            >
                                <Icon className="h-4 w-4" />
                            </button>
                        );
                    })}
                </div>
            ) : null}
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

/** Indent step (px) per nesting level. Each level draws a vertical guide rail. */
const RAIL_STEP = 20;

/**
 * The content column's own top padding (`py-1`), in px.
 *
 * The group's attribution rail is positioned on the ROW, which knows nothing of the column's padding,
 * so a head has to add it back to find the bottom edge of its own portrait.
 */
const ROW_CONTENT_PAD_PX = 4;

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

/**
 * The compact, muted body of an in-group expression row (WI-5): a small differential avatar and the
 * differential's name. It stays an ordinary row (selection / drag / Enter live on the row around it);
 * only the read-only content is compacted.
 *
 * It carries no slot of its own any more (U1): the row already holds the portrait column open for the
 * group's rail, so the annotation starts in the body column with the speaker's words — a look change
 * reads as a note inside the block instead of a line that breaks it.
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
        <span className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-2xs text-fg-subtle">
            <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full border border-edge bg-fill-subtle">
                {imageUrl ? (
                    showingSprite ? (
                        <HeadThumbnail url={imageUrl} alt="" frame={frame} className="h-full w-full" iconClassName="h-2.5 w-2.5" />
                    ) : (
                        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                    )
                ) : null}
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
            {info.role === "option" ? <span aria-hidden className="text-2xs leading-none">○</span> : null}
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
            <div className="mt-1 flex items-center gap-3 text-2xs text-fg-subtle" style={{ paddingLeft: RAIL_STEP }}>
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

// ---------------------------------------------------------------------------
// Staging lens (M7): the bar-timeline rendering of a parallel/race container.
// ---------------------------------------------------------------------------

/** Hatch fill for a track's leading dead time (a wait) — reads as "not an animation", theme-aware. */
const LENS_DELAY_HATCH = "repeating-linear-gradient(45deg, rgb(var(--nl-fg-subtle) / 0.28) 0, rgb(var(--nl-fg-subtle) / 0.28) 2px, transparent 2px, transparent 5px)";
/** Share of the content column the time lane occupies; fixed so every track's bars align left-to-right. */
const LENS_LANE_FLEX = "0 0 44%";

/** The list⇄lens toggle on a parallel/race container header. Pinned while on so the way back is visible. */
function LensToggle(props: { active: boolean; onToggle: () => void }) {
    const { t } = useTranslation();
    const Icon = props.active ? List : GanttChart;
    return (
        <button
            type="button"
            tabIndex={-1}
            title={props.active ? t("story.lens.toList") : t("story.lens.toLens")}
            className={[
                "shrink-0 rounded-md p-1 transition-colors hover:bg-fill hover:text-primary",
                props.active ? "text-primary" : "text-fg-subtle opacity-0 group-hover:opacity-100",
            ].join(" ")}
            onClick={event => {
                event.stopPropagation();
                props.onToggle();
            }}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
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
 * One track's bar. A known duration draws a proportional bar (in the block's category colour), a
 * leading wait draws a hatched dead-time region, and an undeterminable duration draws an equal-width
 * dashed stub. For a race, a thin marker sits at the earliest known finish — and every bar still runs
 * its full length past it, because the engine does NOT abort a race's losers (2026-07-23 裁决).
 */
function LensBar({ track, color }: { track: StoryLensRowTrack; color: string }) {
    const { segment, scaleMs, mode, winnerFinishMs } = track;
    const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / scaleMs) * 100))}%`;
    return (
        <div className="relative h-3.5 self-center rounded-md bg-fill-subtle/70" style={{ flex: LENS_LANE_FLEX }} aria-hidden>
            {segment.unknown || segment.disabled ? (
                // A disabled track is compiled out — it does not set the scale, so a proportional bar
                // would clamp to a misleading full width. Both it and an undeterminable duration show the
                // same equal-width dashed stub: "no footprint on this timeline".
                <div className="absolute inset-y-0 left-0 w-[30%] rounded-md border border-dashed border-fg-subtle/50" />
            ) : (
                <>
                    {segment.delayMs > 0 ? (
                        <div className="absolute inset-y-0 rounded-l" style={{ left: 0, width: pct(segment.delayMs), backgroundImage: LENS_DELAY_HATCH }} />
                    ) : null}
                    {segment.durationMs > 0 ? (
                        <div className="absolute inset-y-0 min-w-[3px] rounded-md" style={{ left: pct(segment.delayMs), width: pct(segment.durationMs), backgroundColor: color, opacity: 0.6 }} />
                    ) : null}
                </>
            )}
            {mode === "race" && winnerFinishMs !== null ? (
                <div className="absolute inset-y-0 w-px bg-primary/70" style={{ left: pct(winnerFinishMs) }}>
                    <span className="absolute -top-1 h-1.5 w-1.5 rounded-full bg-primary" style={{ left: 0, marginLeft: -2.5 }} />
                </div>
            ) : null}
        </div>
    );
}

/**
 * A lensed container's direct child, rendered as a bar-timeline track: the block's badge and overview
 * on the left (its `d=` token stays in-place editable), the duration bar on the right, and the row's
 * own insert/delete actions past it. It is still a full row — selection, drag, inspector, context menu
 * and playhead all live on the row around this — so only the read chrome changes. A nested container
 * shows as one compact subgroup track; the last track carries the tail "+" that inserts a new child
 * into the container (reusing the InsertRow path). Only `RowPlayAction` yields its hover slot to the
 * bar (a declared M7 concession — "play from here" stays reachable from the context menu); prose
 * children never reach here at all, they keep the ordinary row (see `LensTrackKind["text"]`), which is
 * also the only row kind `StoryVoiceIndicator` can ever render on.
 */
function LensTrackContent(props: {
    row: VisibleStoryRow;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    commandContext: StoryCommandContext;
    tempSpeakers: TempSpeakerRef[];
    onSetSpeaker: (speaker: { characterId: string } | { speakerName: string } | null) => void;
    onCreateCharacter: (name: string) => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onAddInside: (parentId: StoryBlockId) => void;
    onInsertAfter: () => void;
    onDeleteRow: () => void;
    active: boolean;
}) {
    const { row, scene, document, characters } = props;
    const block = row.block;
    const track = row.lensTrack!;
    const containerInfo = isContainerBlock(block) ? getContainerHeaderInfo(block) : null;
    const barColor = getBlockBadgeInfo(block).iconColor;
    return (
        <>
            <div className="flex min-h-[var(--nl-story-row-box)] min-w-0 items-center gap-2">
                {containerInfo ? (
                    <ContainerPill info={containerInfo} />
                ) : (
                    <BlockBadge block={block} characters={characters} appearance={row.appearance} />
                )}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    {containerInfo ? (
                        <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{block.childrenIds.length > 0 ? `· ${block.childrenIds.length}` : ""}</span>
                    ) : (
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
                            onUpdatePayload={props.onUpdatePayload}
                        />
                    )}
                </div>
                <LensBar track={track} color={barColor} />
                <RowActions onInsertAfter={props.onInsertAfter} onDelete={props.onDeleteRow} active={props.active} />
            </div>
            {track.segment.isLast && block.parentId ? (
                <LensTailAdd onAdd={() => props.onAddInside(block.parentId as StoryBlockId)} />
            ) : null}
        </>
    );
}

/** The tail "+" under a lens's last track — reuses the container's inside-insert (InsertRow) path. */
function LensTailAdd(props: { onAdd: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="mt-1 flex opacity-0 transition-opacity group-hover:opacity-100">
            <button
                type="button"
                tabIndex={-1}
                title={t("story.container.addAction")}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-fill hover:text-primary"
                onClick={event => {
                    event.stopPropagation();
                    props.onAdd();
                }}
            >
                <Plus className="h-3 w-3" />
                {t("story.container.addAction")}
            </button>
        </div>
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
function CommandGhostHint(props: { value: string; source: string; caret: number; textStyle: CSSProperties; commandContext: StoryCommandContext; confirmation?: string }) {
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
    const menuAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuPlacement = useAutoMenuPlacement(menuAnchorRef, chooser !== "none", 312);
    const pluginCommands = useStoryPluginActionCommands();
    const actionOptions = useMemo<PaletteActionCommand[]>(
        () => searchActionCommands(
            [
                // The typing/filter tier lists one entry per spec — the ranked flat list is the right
                // shape while filtering, so a verb appears once even though it files under many subjects.
                ...specPaletteCommands().map(command => localizeSpecCommand(command, t)),
                // A plugin action carries the label its own language pack already resolved.
                ...pluginCommands,
            ],
            chooserQuery,
        ),
        [chooserQuery, pluginCommands, t],
    );
    // The empty-state browse is the sidebar's projection, not a second catalogue: same `accepts`
    // classification (WI-1), and the same one-row-per-command collapse the sidebar's unfiltered list
    // uses. This menu has no subject filter — it is the whole vocabulary at once — and a verb repeated
    // under six subjects with the same sentence each time reads as six commands, not as one that
    // reaches six places. Which places it reaches is the manual's job to say.
    const browseGroups = useMemo(
        () => dedupeToPrimarySubject(buildSpecSidebarGroups(pluginCommands, command => localizeSpecCommand(command, t))),
        [pluginCommands, t],
    );
    const characterOptions = useMemo(
        () => getSpeakerCandidates(props.characters, props.tempSpeakers, chooserQuery),
        [chooserQuery, props.characters, props.tempSpeakers],
    );
    const actionMenu = useActionCommandMenuState(actionOptions, chooserQuery, browseGroups);
    const characterMenu = useCharacterPickerState(characterOptions);
    const textStyle = useStoryEditorTextStyle();

    // Where the caret is decides what the slot offers, so it has to be state: `/bg fo|` asks for an
    // image, `/bg forest_day t=|` for a transition, and only the caret tells them apart.
    const [caret, setCaret] = useState(props.mode.initialValue.length);
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
                // The kind a name belongs to is carried untranslated; it shares the subject vocabulary
                // the category strip already names, so it reads in the author's own language.
                detail: candidate.detailKind
                    ? t(commandCategoryLabelKey(subjectGroupId(candidate.detailKind)))
                    : candidate.detail,
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
    const argMenuOpen = chooser === "action"
        && (cursor.kind === "paramName" ? argItems.length > 0
            : argValuePosition && (argItems.length > 0 || (cursor.query.length > 0 && hasCandidateSource(cursor.param))));
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
            // Rebuild the whole line, but keep the trigger the author is using so "@" does not flip to
            // "/" mid-completion. The commit path canonicalizes it either way.
            const trigger = actionTrigger(value, props.slashAtAlias) ?? ACTION_TRIGGER;
            applyCompletion(`${trigger}${def.token} `, { start: 0, end: value.length });
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
        <div data-story-insert-slot="" className="relative grid min-h-[calc(var(--nl-story-row-box)+0.5rem)] grid-cols-[var(--nl-story-gutter)_28px_1fr] items-start border-l-2 border-primary bg-fill-subtle pr-3">
            <div aria-hidden />
            <div className="flex min-h-[calc(var(--nl-story-row-box)+0.25rem)] items-center justify-center pt-1">
                <Plus className="h-4 w-4 text-primary" />
            </div>
            <div ref={menuAnchorRef} className="relative min-w-0 py-1">
                {/* Mirror a row's content column so the slot lines up with its future siblings: guide
                    rails + depth indent, then the gutter's portrait column, so the line being typed
                    starts on exactly the baseline the committed row will keep. */}
                <RailGuides depth={props.depth ?? 0} highlight={false} />
                <div style={{ paddingLeft: (props.depth ?? 0) * RAIL_STEP }}>
                <div className="flex min-h-[var(--nl-story-row-box)] items-center gap-2">
                <span className="w-[var(--nl-story-avatar,28px)] shrink-0" aria-hidden />
                {/* The ghost hint sits in a wrapper around the textarea rather than the row's own
                    anchor, so it is positioned against the field's box and inherits its exact metrics.
                    `min-w-0 flex-1` moves off the textarea onto the wrapper; the textarea then fills it. */}
                <div className="relative flex min-w-0 flex-1">
                <CommandGhostHint value={value} source={source} caret={caret} textStyle={textStyle} commandContext={props.commandContext} confirmation={props.mode.confirmation} />
                <textarea
                    ref={props.inputRef}
                    // Same in-place surface as an editing row (see TextEditBox): the new line reads as a
                    // line being typed, not a widget dropped into the list — which is what lets narration's
                    // Enter fall into this slot without the text visibly jumping.
                    className="relative min-h-[20px] w-full resize-none bg-transparent px-0 py-0 text-fg outline-none placeholder:italic placeholder:text-fg-subtle"
                    style={textStyle}
                    rows={1}
                    value={value}
                    // The hint advertises whichever trigger this author actually uses. Suppressed while a
                    // declaration receipt occupies the ghost zone, so the two do not overprint on the
                    // empty slot; the next keystroke clears the receipt and the placeholder is moot anyway.
                    placeholder={props.mode.confirmation ? "" : t("story.rows.insertPlaceholder", { trigger: props.slashAtAlias ? "@" : "/" })}
                    onChange={event => {
                        setCaret(event.target.selectionStart ?? event.target.value.length);
                        setLineValue(event.target.value);
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
                        browse={actionMenu.browse}
                        groups={actionMenu.browseGroups}
                        stops={actionMenu.stops}
                        activeKey={actionMenu.activeStop?.key ?? null}
                        onHighlight={actionMenu.selectKey}
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
                {chooser === "character" ? (
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

/**
 * State for the inline `/` command menu, in two display modes decided by whether the author has typed
 * a query yet:
 *  - **browse** (empty query): the whole command set laid out under subject headers, the SAME
 *    projection the sidebar shows (`buildSpecSidebarGroups`) — a generic verb appears under every
 *    subject its `accepts` names, so an author browsing 图片 finds "显示" exactly where the sidebar
 *    puts it. The two menus are one source now; the `/` browse is no longer a second catalogue filed
 *    single-point by `category` (plan 2026-07-26-003 WI-1).
 *  - **filter** (a query): the matcher's ranked hits, flat across categories, best match first — the
 *    ranking is the point, so headers (and the multi-subject repetition) would only get in its way.
 *
 * `browseGroups` is the pre-derived sidebar projection (empty query); `options` is the ranked flat
 * list for the query. Either way the highlight walks `stops` — one stop per rendered row, keyed by
 * `group:id` so a verb that files under six subjects is six distinct stops. That composite key is what
 * keeps rule 2 true: one keypress moves one stop, one row is `active`, and Enter takes the row on
 * screen rather than the first row that shares its id (see {@link browseMenuStops}).
 */
function useActionCommandMenuState(
    options: PaletteActionCommand[],
    query: string,
    browseGroups: readonly StoryCommandSidebarGroup[],
) {
    const browse = query.trim() === "";
    // The rows the menu shows, in the order the highlight walks them: the sidebar projection while
    // browsing, the raw ranked list (one row per command) while filtering.
    const stops = useMemo<readonly StoryCommandMenuStop[]>(() => {
        if (browse) {
            return browseMenuStops(browseGroups);
        }
        return options.map(command => {
            const group = getCommandGroup(command.group);
            return { key: `${group.id}:${command.id}`, group, command };
        });
    }, [browse, browseGroups, options]);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const activeStop = stops.find(stop => stop.key === activeKey) ?? stops[0] ?? null;

    useEffect(() => {
        setActiveKey(current => stops.some(stop => stop.key === current) ? current : stops[0]?.key ?? null);
    }, [stops]);

    const selectKey = (key: string) => {
        setActiveKey(key);
    };

    const move = (direction: -1 | 1) => {
        if (stops.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, stops.findIndex(stop => stop.key === activeStop?.key));
        const nextIndex = (currentIndex + direction + stops.length) % stops.length;
        setActiveKey(stops[nextIndex].key);
    };

    return {
        browse,
        browseGroups,
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

function ActionCommandMenu(props: {
    browse: boolean;
    groups: readonly StoryCommandSidebarGroup[];
    stops: readonly StoryCommandMenuStop[];
    activeKey: string | null;
    onHighlight: (key: string) => void;
    onChoose: (commandId: string) => void;
    onCancel: () => void;
    placement: PopupPlacement;
}) {
    const { t } = useTranslation();
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

    return (
        <div
            className={["absolute left-0 z-50 w-[420px] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.stops.length === 0 ? (
                <button type="button" className="w-full px-3 py-2 text-left text-sm text-fg-muted hover:bg-fill" onMouseDown={props.onCancel}>
                    {t("story.actionCreator.noActions")}
                </button>
            ) : (
                <div ref={listRef} className="nl-no-scrollbar max-h-64 overflow-auto p-1">
                    {props.browse ? (
                        // Empty query: the sidebar's projection, one section per subject, so the author
                        // sees "here is everything you can do to an image" — a verb appearing under
                        // several subjects is several rows, each its own highlight stop.
                        props.groups.map(entry => {
                            const Icon = entry.group.icon;
                            return (
                                <div key={entry.group.id}>
                                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
                                        <Icon className="h-3 w-3 shrink-0" style={{ color: entry.group.iconColor }} />
                                        <span>{t(commandCategoryLabelKey(entry.group.id))}</span>
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
                    ) : (
                        // A query: the matcher's ranking, flat and best-first — headers would fight it.
                        props.stops.map(stop => (
                            <ActionCommandMenuRow
                                key={stop.key}
                                stop={stop}
                                active={stop.key === props.activeKey}
                                onHighlight={props.onHighlight}
                                onChoose={props.onChoose}
                            />
                        ))
                    )}
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
                        "flex h-full min-h-[28px] max-w-full items-center truncate rounded-md px-1 py-0.5 text-left text-sm hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
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
                    "h-full min-h-[28px] w-[128px] rounded-md border border-primary/50 bg-surface-sunken px-1 py-0.5 text-sm text-fg outline-none",
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
        // Only a *shown* appearance pictures an avatar — a placement-only appearance (a `/move` on a
        // never-shown speaker, used by the group-header dropdown) must not invent a look (WI-3, M3.1).
        return { characterId: block.payload.characterId, formName: appearance?.formName, variants: appearance?.variants, resolveVariant: appearance?.shown === true };
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

/**
 * A row's leading plate: a speaker's face on a dialogue row, the command's category glyph on every
 * other one.
 *
 * `portrait` is what separates the two. A dialogue plate follows the reading density (U1) — 28px in
 * compact, 40px in comfortable, where it becomes the block's own column — because a differential
 * head, a crop selection and a nametag colour are all wasted below about 28px. A category glyph does
 * not grow with it: it is a 14px icon, and a 40px tile around it is chrome.
 */
function BlockBadge({ block, characters, appearance, portrait }: { block: StoryBlock; characters: Character[]; appearance?: CharacterAppearanceRef; portrait?: boolean }) {
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);
    // A differential-resolved sprite (framed on the face) when a look applies; otherwise the profile
    // thumbnail (already a square crop, shown as-is); otherwise the category icon.
    const { url: imageUrl, frame, showingSprite } = useCharacterBadgeImage(block, appearance, characters);

    return (
        <span
            className={[
                "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-fill-subtle",
                portrait ? "h-[var(--nl-story-avatar,28px)] w-[var(--nl-story-avatar,28px)]" : "h-7 w-7",
            ].join(" ")}
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
                    <TextClickTarget style={textStyle}>
                        <RichTextView className="min-w-0 flex-1 whitespace-pre-wrap break-words text-fg" segment={text} document={props.document} sceneId={props.scene.id} />
                    </TextClickTarget>
                ) : (
                    <TextClickTarget style={textStyle} className="italic text-fg-subtle">{getEmptyTextPlaceholder(block)}</TextClickTarget>
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
    // One structured overview path for every action row (bible M5): `[target · modifiers]` with any
    // quick-edit params inline as clickable tokens; a row with none is just an overview whose only
    // fragment is the `describeBlock` fallback. setBackground / displayable-transform keep their rich
    // renderers above (spec-level overrides).
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
const BACKGROUND_STRIP_WIDTH = 180;
/** Dissolves the strip's leading edge into the row instead of cutting a seam down the list. */
const BACKGROUND_STRIP_MASK = "linear-gradient(to right, transparent, #000 62%)";
/** The label's cap: the content column, less the strip it must not run under. */
const BACKGROUND_LABEL_MAX_WIDTH = `calc(100% - ${BACKGROUND_STRIP_WIDTH + 24}px)`;

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
            <span className="min-w-0 truncate">
                {t("story.rows.transform")} <span className="text-fg">{name}</span>
                {asset ? <span className="text-fg-subtle"> · {asset.name}</span> : null}
            </span>
        </span>
    );
}
