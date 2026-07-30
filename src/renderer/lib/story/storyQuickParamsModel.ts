import type { StoryBlock } from "@shared/types/story";
import { formatStorySecondsValue } from "@shared/utils/storyTime";

/**
 * The pure half of the row's inline quick-edit params (bible M5 / WI-2): which params a committed
 * block exposes, what each one reads as, and how to write it back.
 *
 * Split out of `storyQuickParams.tsx` because the params are *fragments of the row's sentence*, not
 * decoration on top of it — `Set background outside_s.jpg d 5s` is one sentence, and the `d 5s` half
 * of it lives here. The Dev Mode timeline has to print the same sentence without mounting any of the
 * editor's popovers, so the model has to be reachable without the components (U4 WI-1).
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
    if (payload.action === "camera") {
        // The camera's `d=` is the whole feel of the move — the one knob worth a token on the row.
        // Except under `motion`, where the timing lives in the bound Story Motion's keyframes: an
        // editable `d=` there would offer to tune a number nothing reads.
        return payload.operation === "motion"
            ? []
            : [durationParam("d", "d", payload.durationMs ?? 0, undefined, ms => ({ ...payload, durationMs: ms }))];
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

/** What a token prints — the value alone; {@link quickParamText} adds the leading key. */
export function quickParamDisplayValue(value: QuickParamValue, sceneName: (id: string | undefined) => string): string {
    switch (value.kind) {
        case "duration": return `${formatStorySecondsValue(value.ms)}s`;
        case "percent": return `${Math.round(value.ratio * 100)}%`;
        case "toggle": return "loop";
        case "scene": return sceneName(value.sceneId);
    }
}

/** A token as plain text — `d 5s`, `vol 80%` — exactly what the editor's clickable token reads as. */
export function quickParamText(param: QuickParam, sceneName: (id: string | undefined) => string): string {
    const value = quickParamDisplayValue(param.value, sceneName);
    return param.label ? `${param.label} ${value}` : value;
}
