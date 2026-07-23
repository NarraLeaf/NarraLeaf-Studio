import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { StoryBlock, StoryScene, StorySceneId } from "@shared/types/story";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { useTranslation } from "@/lib/i18n";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { describeBlock } from "./storySceneBlockUtils";
import type { Character } from "@/lib/workspace/services/character/Character";

/**
 * Inline quick-edit params (WI-2). A small, high-frequency subset of a committed row's params —
 * declared per command via `StoryCommandSpec.quickParams` — surfaced in the row summary as clickable
 * tokens so a tweak never has to open the inspector. There is no block→command parser, so the value
 * is read straight from the payload here and written back through the same history path the inspector
 * uses (`onUpdatePayload`), which keeps every quick edit undoable.
 */

/** Wait presets, in ms — the bible's B10 "high-frequency" set. */
const WAIT_PRESETS_MS = [200, 500, 1000, 2000, 3000];
/** Audio operations that carry a meaningful volume / loop. */
const VOLUME_OPS = new Set(["setBgm", "playSound", "setVolume"]);
const LOOP_OPS = new Set(["setBgm", "playSound"]);

export type QuickParamValue =
    | { kind: "duration"; ms: number; presetsMs?: number[] }
    | { kind: "percent"; ratio: number }
    | { kind: "toggle"; on: boolean }
    | { kind: "scene"; sceneId: string | undefined };

export type QuickParam = {
    id: string;
    /** Short leading label (the canonical param key, English) — empty for a value-only token. */
    label: string;
    value: QuickParamValue;
    /** The block payload with this param set to `next`. */
    apply: (next: QuickParamValue) => StoryBlock["payload"];
};

function durationParam(id: string, label: string, ms: number, presetsMs: number[] | undefined, apply: (ms: number) => StoryBlock["payload"]): QuickParam {
    return {
        id,
        label,
        value: { kind: "duration", ms, presetsMs },
        apply: next => (next.kind === "duration" ? apply(next.ms) : apply(ms)),
    };
}

/**
 * The quick-edit params a committed block exposes, or `[]` for a block with none. Read directly from
 * the payload; a transition duration only shows when a transition already exists, so a quick edit
 * never has to invent a transition kind (add one from the inspector first).
 */
export function getQuickParams(block: StoryBlock): QuickParam[] {
    if (block.kind === "jump") {
        const payload = block.payload;
        return [{
            id: "scene",
            label: "",
            value: { kind: "scene", sceneId: payload.targetSceneId },
            apply: next => (next.kind === "scene" ? { ...payload, targetSceneId: next.sceneId ?? payload.targetSceneId } : payload),
        }];
    }
    if (block.kind !== "action") {
        return [];
    }
    const payload = block.payload;
    if (payload.action === "wait") {
        if (payload.mode !== "duration") {
            return [];
        }
        return [durationParam("duration", "", payload.durationMs ?? 0, WAIT_PRESETS_MS, ms => ({ ...payload, mode: "duration", durationMs: ms }))];
    }
    if (payload.action === "setBackground") {
        const transition = payload.transition;
        if (!transition) {
            return [];
        }
        return [durationParam("d", "d", transition.durationMs ?? 0, undefined, ms => ({ ...payload, transition: { ...transition, durationMs: ms } }))];
    }
    if (payload.action === "character" && (payload.operation === "enter" || payload.operation === "exit")) {
        const transition = payload.transition;
        if (!transition) {
            return [];
        }
        return [durationParam("d", "d", transition.durationMs ?? 0, undefined, ms => ({ ...payload, transition: { ...transition, durationMs: ms } }))];
    }
    if (payload.action === "audio") {
        const params: QuickParam[] = [];
        if (VOLUME_OPS.has(payload.operation)) {
            params.push({
                id: "vol",
                label: "vol",
                value: { kind: "percent", ratio: payload.volume ?? 1 },
                apply: next => (next.kind === "percent" ? { ...payload, volume: next.ratio } : payload),
            });
        }
        if (LOOP_OPS.has(payload.operation)) {
            params.push({
                id: "loop",
                label: "loop",
                value: { kind: "toggle", on: payload.loop ?? false },
                apply: next => (next.kind === "toggle" ? { ...payload, loop: next.on } : payload),
            });
        }
        return params;
    }
    return [];
}

function displayValue(value: QuickParamValue, sceneName: (id: string | undefined) => string): string {
    switch (value.kind) {
        case "duration": return `${formatStorySecondsValue(value.ms)}s`;
        case "percent": return `${Math.round(value.ratio * 100)}%`;
        case "toggle": return "loop";
        case "scene": return sceneName(value.sceneId);
    }
}

const TOKEN_CLASS = "cursor-pointer rounded px-0.5 underline decoration-dotted decoration-fg-subtle/60 underline-offset-2 transition-colors hover:bg-fill hover:text-fg";

/**
 * One piece of a committed row's overview projection (WI-2 / bible M5): either a run of plain text
 * (the target name and any modifiers the tokens do not own) or a clickable quick-edit token. The
 * tokens ARE fragments in the same stream, not a second layer appended after a finished string.
 */
export type OverviewFragment =
    | { kind: "text"; text: string }
    | { kind: "quick"; param: QuickParam };

/**
 * The structured overview of a committed action row (bible M5): `[target · modifiers]` with the
 * quick-edit params spliced in as first-class fragments. The row's *verb* lives in its badge
 * (`getBlockBadgeInfo`), so the base text carries the target plus whatever the tokens do not own;
 * `describeBlock` is that base — demoted here to the default fallback. wait/jump print their value
 * only through the token, so their base is the bare verb label to avoid saying it twice.
 *
 * Keyed on payload shape, not a command spec: a committed block carries no command id (bible B11 —
 * no reverse edit) and generic verbs make payload→spec many-to-one, so a payload-shape projection is
 * the honest home — the same shape `describeBlock` / `getBlockBadgeInfo` / `getQuickParams` take.
 */
export function blockOverview(
    block: StoryBlock,
    characters: Character[],
    scene: StoryScene | undefined,
    scenes: Record<StorySceneId, StoryScene> | undefined,
    label: (key: "story.quickParam.jumpLabel" | "story.quickParam.waitLabel") => string,
): OverviewFragment[] {
    const params = getQuickParams(block);
    // The bare verb label replaces `describeBlock` only when a token actually prints the value, or it
    // would show twice. A click-mode `/wait` owns no token, so it keeps its full "Wait for click" text.
    const valueInToken = params.length > 0 && ((block.kind === "action" && block.payload.action === "wait") || block.kind === "jump");
    const base = !valueInToken
        ? describeBlock(block, characters, scene, scenes)
        : block.kind === "jump"
            ? label("story.quickParam.jumpLabel")
            : label("story.quickParam.waitLabel");
    const fragments: OverviewFragment[] = [];
    if (base) {
        fragments.push({ kind: "text", text: base });
    }
    for (const param of params) {
        fragments.push({ kind: "quick", param });
    }
    return fragments;
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
    const fragments = blockOverview(props.block, props.characters, props.scene, props.scenes, key => t(key));

    return (
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-fg-muted" style={props.textStyle}>
            {fragments.map((fragment, index) =>
                fragment.kind === "text"
                    ? <span key={`t${index}`} className="truncate">{fragment.text}</span>
                    : <QuickParamToken key={fragment.param.id} param={fragment.param} scenes={props.scenes} onApply={props.onUpdatePayload} />,
            )}
        </span>
    );
}

/** The bare clickable tokens for a set of quick params, reused wherever a row draws its own summary. */
export function QuickParamsInline(props: {
    params: QuickParam[];
    scenes?: Record<StorySceneId, StoryScene>;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
}) {
    return (
        <>
            {props.params.map(param => (
                <QuickParamToken key={param.id} param={param} scenes={props.scenes} onApply={props.onUpdatePayload} />
            ))}
        </>
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
                                    className="h-6 rounded border border-edge bg-surface px-1.5 text-2xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
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
                                className={`flex w-full items-center rounded px-2 py-1.5 text-left text-sm transition-colors ${selected ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"}`}
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
