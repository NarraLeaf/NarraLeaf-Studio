import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { StoryBlock, StoryScene, StorySceneId } from "@shared/types/story";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { useCommandTranslation, useTranslation } from "@/lib/i18n";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import {
    getQuickParams,
    quickParamDisplayValue as displayValue,
    type QuickParam,
    type QuickParamValue,
} from "@/lib/story/storyQuickParamsModel";
import { characterRowLookup } from "./storySceneBlockUtils";
import { useStoryMotionNames } from "./useStoryMotionNames";
import {
    StoryCommandLineBox,
    StoryCommandLineText,
    useStoryCommandLine,
    useStoryCommandLineContext,
} from "./StoryCommandLineView";
import { StoryLineValueToken } from "./StoryLineValueToken";
import { StoryLineCharacterFace } from "./storyCharacterFace";
import type { StoryCommandLineProjection } from "./storyCommandLine";
import { storyActionRowFragments, type StoryRowFragment } from "@/lib/story/storyRowProjection";
import type { Character } from "@/lib/workspace/services/character/Character";

/**
 * Inline quick-edit params (WI-2). A small, high-frequency subset of a committed row's params —
 * declared per command via `StoryCommandSpec.quickParams` — surfaced in the row summary as clickable
 * tokens so a tweak never has to open the inspector. There is no block→command parser, so the value
 * is read straight from the payload here and written back through the same history path the inspector
 * uses (`onUpdatePayload`), which keeps every quick edit undoable.
 *
 * The model half (which params a block has, and what each one reads as) moved to
 * `@/lib/story/storyQuickParamsModel` with U4 WI-1: the tokens are fragments of the row's *sentence*,
 * and the Dev Mode timeline has to print that sentence without mounting any of these popovers.
 */

export { getQuickParams, type QuickParam, type QuickParamValue };

const TOKEN_CLASS = "cursor-pointer rounded-md px-0.5 underline decoration-dotted decoration-fg-subtle/60 underline-offset-2 transition-colors hover:bg-fill hover:text-fg";

/**
 * One piece of a committed row's overview projection (WI-2 / bible M5): either a run of plain text
 * (the target name and any modifiers the tokens do not own) or a clickable quick-edit token. The
 * tokens ARE fragments in the same stream, not a second layer appended after a finished string.
 */
export type OverviewFragment = StoryRowFragment;

/**
 * The structured overview of a committed action row (bible M5): `[target · modifiers]` with the
 * quick-edit params spliced in as first-class fragments.
 *
 * A thin `Character[]` adapter over the shared `storyActionRowFragments` (U4 WI-1) — the projection
 * itself is what the Dev Mode timeline reads, so the two surfaces cannot drift.
 */
export function blockOverview(
    block: StoryBlock,
    characters: Character[],
    scene: StoryScene | undefined,
    scenes: Record<StorySceneId, StoryScene> | undefined,
    label: (key: "story.quickParam.jumpLabel" | "story.quickParam.waitLabel") => string,
    motionName?: (animationId: string) => string | null,
): OverviewFragment[] {
    return storyActionRowFragments(block, { character: characterRowLookup(characters), scene, scenes, motionName }, label);
}

/**
 * Render a committed row's overview: the structured `[target][modifiers]` fragment stream, with any
 * quick-edit params inline as clickable tokens (WI-2). The single summary path for every action row —
 * a plain-`describeBlock` row is just an overview with no token fragments.
 */
export function BlockOverview(props: {
    block: StoryBlock;
    characters: Character[];
    scene?: StoryScene;
    scenes?: Record<StorySceneId, StoryScene>;
    textStyle?: CSSProperties;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const { t } = useTranslation();
    // Subscribed to, not called: the row's verb is the command's own name, and the projection reaches
    // it through the imperative `translateCommand` — a snapshot with no way to tell React it went
    // stale. Without this hook a language change leaves every committed row in the old vocabulary
    // until something else happens to re-render it.
    useCommandTranslation();
    // Resolved here rather than threaded from the rows host: the projection stays pure and the React
    // layer, which has the service, supplies the lookup (the rule `describeBlockSubject` documents).
    const motionName = useStoryMotionNames();
    const line = useStoryCommandLine(props.block, props.characters, props.scene, props.scenes);

    if (line) {
        return (
            <StoryCommandLineRow
                line={line}
                block={props.block}
                characters={props.characters}
                textStyle={props.textStyle}
                scenes={props.scenes}
                onUpdatePayload={props.onUpdatePayload}
            />
        );
    }

    const fragments = blockOverview(props.block, props.characters, props.scene, props.scenes, key => t(key), motionName);
    return (
        // The rows no command owns keep the old reading: italic, and no fragment brighter than
        // `fg-muted`. A stage direction that cannot be typed as a line has no skeleton to echo, so it
        // stays prose rather than borrowing the syntax colours of a line it is not.
        <span className="flex min-h-[var(--nl-story-row-box)] min-w-0 flex-1 items-center gap-1 truncate text-sm italic text-fg-muted" style={props.textStyle}>
            {fragments.map((fragment, index) =>
                fragment.kind === "text"
                    ? <span key={`t${index}`} className="truncate">{fragment.text}</span>
                    : <QuickParamToken key={fragment.param.id} param={fragment.param} scenes={props.scenes} onApply={props.onUpdatePayload} />,
            )}
        </span>
    );
}

/**
 * A committed row as the command line that produced it: the same coloured skeleton the live field
 * shows, dimmed.
 *
 * Dimmed by opacity on the whole line rather than by a second, darker palette — one palette is what
 * makes "typed" and "committed" read as two states of one thing instead of two designs. Every option
 * the line carries stays first-class inside it: values keep their colour and only add the dotted
 * underline that says a click will edit them.
 *
 * The one thing the row has that the typed line does not is the faces: a character command draws its
 * subject's portrait in front of the name, at the line's own font size. It is the row that can afford
 * it — the live field is a mirror over a textarea and has to stay text-for-text.
 */
function StoryCommandLineRow(props: {
    line: StoryCommandLineProjection;
    block: StoryBlock;
    characters: Character[];
    textStyle?: CSSProperties;
    scenes?: Record<StorySceneId, StoryScene>;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    const { trigger } = useStoryCommandLineContext();
    return (
        <StoryCommandLineBox className="opacity-80" style={props.textStyle}>
            <StoryCommandLineText
                source={props.line.source}
                trigger={trigger}
                edits={props.line.edits}
                renderEdit={(edit, content) => (
                    <StoryLineValueToken edit={edit} onApply={props.onUpdatePayload}>{content}</StoryLineValueToken>
                )}
                ornaments={props.line.ornaments}
                // The block, not the ornament's id: the picture is of this row's own look — the pose
                // and tags in its payload — and the id is what says the line names a character at all.
                renderOrnament={ornament => (
                    <StoryLineCharacterFace key={ornament.id} block={props.block} characters={props.characters} />
                )}
            />
        </StoryCommandLineBox>
    );
}

function QuickParamToken(props: {
    param: QuickParam;
    scenes?: Record<StorySceneId, StoryScene>;
    onApply: (payload: StoryBlock["payload"]) => void;
}) {
    const { param } = props;
    const [anchor, setAnchor] = useState<{ top: number; left: number; bottom: number } | null>(null);
    const sceneName = (id: string | undefined) => (id ? props.scenes?.[id]?.name || id : "—");

    const open = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        // A boolean flips in place — a popover for two states is friction, not affordance.
        if (param.value.kind === "toggle") {
            props.onApply(param.apply({ kind: "toggle", on: !param.value.on }));
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
    };

    const isOff = param.value.kind === "toggle" && !param.value.on;

    return (
        <>
            <button
                type="button"
                className={`${TOKEN_CLASS} ${isOff ? "text-fg-subtle line-through decoration-solid" : ""}`}
                onMouseDown={event => event.stopPropagation()}
                onClick={open}
                title={param.label || undefined}
            >
                {param.label ? `${param.label} ` : ""}{displayValue(param.value, sceneName)}
            </button>
            {anchor ? (
                <QuickParamPopover
                    param={param}
                    anchor={anchor}
                    scenes={props.scenes}
                    onApply={payload => { props.onApply(payload); }}
                    onClose={() => setAnchor(null)}
                />
            ) : null}
        </>
    );
}

function QuickParamPopover(props: {
    param: QuickParam;
    anchor: { top: number; left: number; bottom: number };
    scenes?: Record<StorySceneId, StoryScene>;
    onApply: (payload: StoryBlock["payload"]) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const { param } = props;

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (panelRef.current?.contains(event.target as Node)) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 200);
    const left = Math.min(props.anchor.left, window.innerWidth - 236);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-56 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
            {param.value.kind === "duration" ? (
                <div>
                    <div className="flex items-center gap-1.5">
                        <NumericDraftEnhancedInput
                            committedDisplay={formatStorySecondsValue(param.value.ms)}
                            onFiniteNumber={seconds => props.onApply(param.apply({ kind: "duration", ms: Math.max(0, storySecondsToMs(seconds)) }))}
                            onEmpty={() => props.onApply(param.apply({ kind: "duration", ms: 0 }))}
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            popoverWhenNarrow={false}
                            className="w-24"
                            inputClassName="h-8 rounded-md border border-edge bg-surface-raised px-2 text-sm text-fg outline-none focus:border-primary/50"
                        />
                        <span className="text-xs text-fg-muted">{t("story.pause.seconds")}</span>
                    </div>
                    {param.value.presetsMs ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {param.value.presetsMs.map(ms => (
                                <button
                                    key={ms}
                                    type="button"
                                    className="h-6 rounded-md border border-edge bg-surface px-1.5 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                                    onClick={() => props.onApply(param.apply({ kind: "duration", ms }))}
                                >
                                    {formatStorySecondsValue(ms)}s
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
            {param.value.kind === "percent" ? (
                <div className="flex items-center gap-1.5">
                    <NumericDraftEnhancedInput
                        committedDisplay={String(Math.round(param.value.ratio * 100))}
                        onFiniteNumber={percent => props.onApply(param.apply({ kind: "percent", ratio: Math.min(1, Math.max(0, percent / 100)) }))}
                        onEmpty={() => props.onApply(param.apply({ kind: "percent", ratio: 0 }))}
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        popoverWhenNarrow={false}
                        className="w-24"
                        inputClassName="h-8 rounded-md border border-edge bg-surface-raised px-2 text-sm text-fg outline-none focus:border-primary/50"
                    />
                    <span className="text-xs text-fg-muted">%</span>
                </div>
            ) : null}
            {param.value.kind === "scene" ? (
                <div className="max-h-56 overflow-y-auto">
                    {Object.values(props.scenes ?? {}).map(scene => {
                        const selected = param.value.kind === "scene" && param.value.sceneId === scene.id;
                        return (
                            <button
                                key={scene.id}
                                type="button"
                                className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors ${selected ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"}`}
                                onClick={() => { props.onApply(param.apply({ kind: "scene", sceneId: scene.id })); props.onClose(); }}
                            >
                                <span className="truncate">{scene.name || scene.id}</span>
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>,
        document.body,
    );
}
