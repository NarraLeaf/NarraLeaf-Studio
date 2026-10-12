import type { StoryLayerRef, StoryScene, StorySceneLayer, StorySceneLayerId } from "./document";
import { normalizeStageObjectName } from "./displayableTarget";

/**
 * The most of the camera's movement a layer may follow: twice what the characters follow, a layer
 * well in front of them. Further than that and a slow pan sweeps the layer off the screen.
 */
export const STORY_LAYER_FOLLOW_MAX = 2;

type CustomSceneLayer = Extract<StorySceneLayer, { kind: "custom" }>;

/** A share of the camera's movement as the document keeps it: within range, to the hundredth. */
export function clampLayerFollow(value: unknown, min = 0, max = STORY_LAYER_FOLLOW_MAX): number {
    const share = typeof value === "number" && Number.isFinite(value) ? value : 1;
    return Math.round(Math.min(max, Math.max(min, share)) * 100) / 100;
}

/**
 * How much of the camera's movement a layer follows. The characters' layer follows all of it by
 * definition - it is the stage the camera is aimed at - and the background layer, which is behind
 * it, never more than that.
 */
export function sceneLayerFollow(layer: StorySceneLayer): number {
    if (layer.kind === "displayable") {
        return 1;
    }
    return clampLayerFollow(layer.follow, 0, layer.kind === "background" ? 1 : STORY_LAYER_FOLLOW_MAX);
}

/**
 * The scene's layers, front to back, always well formed.
 *
 * Read through here rather than off `scene.layers`, which may be absent (a scene with no layers of
 * its own) or hand-edited into a shape the stage cannot have; see {@link normalizeSceneLayerStack}.
 */
export function sceneLayerStack(scene: Pick<StoryScene, "layers"> | null | undefined): StorySceneLayer[] {
    return normalizeSceneLayerStack(scene?.layers);
}

/**
 * A stack the stage can have, made from whatever was stored:
 *  - each built-in layer exactly once, the background behind the characters (a stack missing one
 *    gets it back where it always was: the characters in front of the background, the background last);
 *  - each layer of the scene's own once, by id;
 *  - each layer following no more of the camera than the one in front of it, counted out from the
 *    characters' layer, which follows all of it. A layer that says otherwise is moved to the share of
 *    its neighbour rather than to another place in the stack: the order is what the author sees in
 *    every still, and the share only once the camera moves.
 *
 * Deterministic and idempotent, because the document's normalize pass writes its answer back.
 */
export function normalizeSceneLayerStack(layers: readonly unknown[] | undefined): StorySceneLayer[] {
    const stack: StorySceneLayer[] = [];
    const ids = new Set<string>();
    let hasDisplayable = false;
    let hasBackground = false;
    for (const raw of layers ?? []) {
        if (!raw || typeof raw !== "object") {
            continue;
        }
        const entry = raw as { kind?: unknown; id?: unknown; name?: unknown; follow?: number };
        if (entry.kind === "displayable" && !hasDisplayable) {
            hasDisplayable = true;
            stack.push({ kind: "displayable" });
        } else if (entry.kind === "background" && !hasBackground) {
            hasBackground = true;
            stack.push({ kind: "background", follow: entry.follow });
        } else if (entry.kind === "custom") {
            const id = typeof entry.id === "string" ? entry.id.trim() : "";
            if (!id || ids.has(id)) {
                continue;
            }
            ids.add(id);
            stack.push({ kind: "custom", id, name: typeof entry.name === "string" ? entry.name.trim() : "", follow: entry.follow });
        }
    }
    if (!hasDisplayable) {
        const background = stack.findIndex(layer => layer.kind === "background");
        stack.splice(background === -1 ? stack.length : background, 0, { kind: "displayable" });
    }
    if (!hasBackground) {
        stack.push({ kind: "background" });
    }
    const displayable = stack.findIndex(layer => layer.kind === "displayable");
    const background = stack.findIndex(layer => layer.kind === "background");
    if (background < displayable) {
        const [moved] = stack.splice(background, 1);
        stack.splice(displayable, 0, moved);
    }
    return withMonotonicFollow(stack);
}

/** Every share settled against its neighbours, counted out from the characters' layer; `1` is left unstated. */
function withMonotonicFollow(stack: StorySceneLayer[]): StorySceneLayer[] {
    const anchor = stack.findIndex(layer => layer.kind === "displayable");
    const shares = stack.map(sceneLayerFollow);
    for (let index = anchor - 1; index >= 0; index -= 1) {
        shares[index] = Math.max(shares[index], shares[index + 1]);
    }
    for (let index = anchor + 1; index < stack.length; index += 1) {
        shares[index] = Math.min(shares[index], shares[index - 1]);
    }
    return stack.map((layer, index) => withFollow(layer, shares[index]));
}

function withFollow(layer: StorySceneLayer, follow: number): StorySceneLayer {
    if (layer.kind === "displayable") {
        return { kind: "displayable" };
    }
    if (layer.kind === "background") {
        return follow === 1 ? { kind: "background" } : { kind: "background", follow };
    }
    const { follow: _follow, ...rest } = layer;
    return follow === 1 ? rest : { ...rest, follow };
}

/** Whether a stack is the one every scene has before it has a layer of its own, which the document leaves unstated. */
export function isDefaultSceneLayerStack(stack: readonly StorySceneLayer[]): boolean {
    return stack.length === 2
        && stack[0].kind === "displayable"
        && stack[1].kind === "background"
        && sceneLayerFollow(stack[1]) === 1;
}

/** Whether two stacks say the same thing, layer by layer. */
export function sameSceneLayerStack(a: readonly StorySceneLayer[], b: readonly StorySceneLayer[]): boolean {
    return a.length === b.length && a.every((layer, index) => {
        const other = b[index];
        if (layer.kind !== other.kind || sceneLayerFollow(layer) !== sceneLayerFollow(other)) {
            return false;
        }
        return layer.kind !== "custom" || (other.kind === "custom" && layer.id === other.id && layer.name === other.name);
    });
}

/**
 * The z-index the engine is given for a layer of the scene's own, so it draws the stack in the stack's
 * order. The engine sorts layers by it and nothing else, and its two built-ins sit at -1 (background)
 * and 0 (characters) - so the layers in front of the characters count up from 1, the ones between the
 * two built-ins share out the gap, and the ones behind the background count down from -2.
 */
export function sceneLayerZIndex(stack: readonly StorySceneLayer[], index: number): number {
    const displayable = stack.findIndex(layer => layer.kind === "displayable");
    const background = stack.findIndex(layer => layer.kind === "background");
    if (index === displayable) {
        return 0;
    }
    if (index === background) {
        return -1;
    }
    if (index < displayable) {
        return displayable - index;
    }
    if (index < background) {
        return -(index - displayable) / (background - displayable);
    }
    return -1 - (index - background);
}

/** The highest and lowest share a layer at `index` may take: no more than the layer in front, no less than the one behind. */
export function sceneLayerFollowBounds(stack: readonly StorySceneLayer[], index: number): { min: number; max: number } {
    const layer = stack[index];
    if (!layer || layer.kind === "displayable") {
        return { min: 1, max: 1 };
    }
    const front = stack[index - 1];
    const behind = stack[index + 1];
    const ceiling = layer.kind === "background" ? 1 : STORY_LAYER_FOLLOW_MAX;
    return {
        min: behind ? sceneLayerFollow(behind) : 0,
        max: Math.min(ceiling, front ? sceneLayerFollow(front) : ceiling),
    };
}

/**
 * The stack with one layer at a new share. The layer takes its place by it: past a neighbour's share
 * it is past the neighbour, so the stack's order never contradicts how far away its layers are. A
 * layer that ties with others stays on the side of them it came from.
 *
 * The characters' layer has no share to change, and the background layer goes no nearer than the
 * characters - it stays behind them.
 */
export function setSceneLayerFollow(stack: readonly StorySceneLayer[], index: number, follow: number): StorySceneLayer[] {
    const layer = stack[index];
    if (!layer || layer.kind === "displayable") {
        return [...stack];
    }
    const share = clampLayerFollow(follow, 0, layer.kind === "background" ? 1 : STORY_LAYER_FOLLOW_MAX);
    const next = stack.map((entry, at) => (at === index ? withFollow(entry, share) : entry));
    // Stable, so only the layer that moved changes places.
    return next
        .map((entry, at) => ({ entry, at }))
        .sort((a, b) => sceneLayerFollow(b.entry) - sceneLayerFollow(a.entry) || a.at - b.at)
        .map(({ entry }) => entry);
}

/**
 * The stack with one layer moved to another place in it, or null when it cannot go there. A layer
 * keeps its share where it still fits between its new neighbours and otherwise takes the nearer of
 * theirs, which is the share its new place calls for.
 *
 * The characters' layer does not move - it is what the others are in front of or behind - and the
 * background layer cannot go in front of it. `to` is the layer's index once moved.
 */
export function moveSceneLayer(stack: readonly StorySceneLayer[], from: number, to: number): StorySceneLayer[] | null {
    const layer = stack[from];
    if (!layer || layer.kind === "displayable" || from === to || to < 0 || to >= stack.length) {
        return null;
    }
    const next = stack.filter((_, index) => index !== from);
    next.splice(to, 0, layer);
    if (layer.kind === "background" && to < next.findIndex(entry => entry.kind === "displayable")) {
        return null;
    }
    const bounds = sceneLayerFollowBounds(next, to);
    next[to] = withFollow(layer, clampLayerFollow(sceneLayerFollow(layer), bounds.min, bounds.max));
    return next;
}

/**
 * The stack with a new layer of the scene's own. It goes just behind the characters unless `at` says
 * otherwise, at the share its place calls for - just behind the characters that is all of the
 * camera's movement, so a new layer moves exactly as every layer always has until the author says
 * how far away it is.
 */
export function addSceneLayer(
    stack: readonly StorySceneLayer[],
    layer: { id: StorySceneLayerId; name: string },
    at?: number,
): StorySceneLayer[] {
    const index = at ?? stack.findIndex(entry => entry.kind === "displayable") + 1;
    const next = [...stack];
    next.splice(Math.max(0, Math.min(next.length, index)), 0, { kind: "custom", id: layer.id, name: layer.name });
    const placed = Math.max(0, Math.min(next.length - 1, index));
    const bounds = sceneLayerFollowBounds(next, placed);
    next[placed] = withFollow(next[placed], clampLayerFollow(1, bounds.min, bounds.max));
    return next;
}

export function renameSceneLayer(stack: readonly StorySceneLayer[], id: StorySceneLayerId, name: string): StorySceneLayer[] {
    return stack.map(layer => (layer.kind === "custom" && layer.id === id ? { ...layer, name: name.trim() } : layer));
}

export function removeSceneLayer(stack: readonly StorySceneLayer[], id: StorySceneLayerId): StorySceneLayer[] {
    return stack.filter(layer => layer.kind !== "custom" || layer.id !== id);
}

/** The scene layer a reference resolves to, by id and then by name; null when it names a layer the scene does not have. */
export function sceneLayerForRef(scene: Pick<StoryScene, "layers"> | null | undefined, ref: StoryLayerRef | undefined): StorySceneLayer | null {
    if (!ref) {
        return { kind: "displayable" };
    }
    const stack = sceneLayerStack(scene);
    if (ref.kind === "default") {
        return stack.find(layer => layer.kind === ref.layer) ?? null;
    }
    return (ref.sourceBlockId ? findCustomLayer(stack, ref.sourceBlockId) : undefined)
        ?? (ref.name?.trim() ? findCustomLayerByName(stack, ref.name) : undefined)
        ?? null;
}

/** The scene's own layer with this id. */
export function findSceneLayer(scene: Pick<StoryScene, "layers"> | null | undefined, id: StorySceneLayerId): CustomSceneLayer | undefined {
    return findCustomLayer(sceneLayerStack(scene), id);
}

/** The scene's own layer the stage knows by this name - the key `normalizeStageObjectName` makes of it. */
export function findSceneLayerByName(scene: Pick<StoryScene, "layers"> | null | undefined, name: string): CustomSceneLayer | undefined {
    return findCustomLayerByName(sceneLayerStack(scene), name);
}

function findCustomLayer(stack: readonly StorySceneLayer[], id: string): CustomSceneLayer | undefined {
    return stack.find((layer): layer is CustomSceneLayer => layer.kind === "custom" && layer.id === id);
}

function findCustomLayerByName(stack: readonly StorySceneLayer[], name: string): CustomSceneLayer | undefined {
    const key = normalizeStageObjectName(name);
    return stack.find((layer): layer is CustomSceneLayer => layer.kind === "custom" && normalizeStageObjectName(layer.name) === key);
}

/** The reference a row stores to put something on this layer. */
export function storyLayerRefFor(layer: StorySceneLayer): StoryLayerRef {
    return layer.kind === "custom"
        ? { kind: "custom", sourceBlockId: layer.id, name: layer.name }
        : { kind: "default", layer: layer.kind };
}

/** Whether a reference points at this layer. An absent reference is the characters' layer. */
export function storyLayerRefIs(scene: Pick<StoryScene, "layers"> | null | undefined, ref: StoryLayerRef | undefined, layer: StorySceneLayer): boolean {
    const resolved = sceneLayerForRef(scene, ref);
    if (!resolved || resolved.kind !== layer.kind) {
        return false;
    }
    return resolved.kind !== "custom" || (layer.kind === "custom" && resolved.id === layer.id);
}

/**
 * The words a layer cannot be called, because the command line and the script already mean a
 * built-in layer by them.
 */
const RESERVED_LAYER_NAMES = new Set(["backgroundlayer", "displayablelayer", "stagelayer"]);

/**
 * Why a name will not do for a layer of this stack, or null when it will: empty, one of the words the
 * built-in layers are written with, or the name of another of the scene's layers - two layers the
 * stage knows by one name would be one layer to every row that names it.
 */
export function sceneLayerNameProblem(
    stack: readonly StorySceneLayer[],
    name: string,
    ownId?: StorySceneLayerId,
): "empty" | "reserved" | "taken" | null {
    const trimmed = name.trim();
    if (!trimmed) {
        return "empty";
    }
    if (RESERVED_LAYER_NAMES.has(trimmed.toLowerCase())) {
        return "reserved";
    }
    const key = normalizeStageObjectName(trimmed);
    return stack.some(layer => layer.kind === "custom" && layer.id !== ownId && normalizeStageObjectName(layer.name) === key)
        ? "taken"
        : null;
}

/** `base`, or `base` with the first number after it that no layer of the stack is called yet. */
export function uniqueSceneLayerName(stack: readonly StorySceneLayer[], base: string): string {
    const stem = base.trim() || "layer";
    if (sceneLayerNameProblem(stack, stem) === null) {
        return stem;
    }
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${stem}${suffix}`;
        if (sceneLayerNameProblem(stack, candidate) === null) {
            return candidate;
        }
    }
}

/**
 * The value with every `sourceBlockId` the map names pointed at the id it maps to, wherever in the
 * value the reference sits. What holds none comes back as it was - the same object, so a caller can
 * tell an untouched row by identity.
 */
export function rebindSceneLayerIds<T>(value: T, rebind: ReadonlyMap<string, string>): T {
    if (rebind.size === 0 || !value || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map(item => {
            const mapped = rebindSceneLayerIds(item, rebind);
            changed ||= mapped !== item;
            return mapped;
        });
        return (changed ? next : value) as T;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const mapped = key === "sourceBlockId" && typeof item === "string" && rebind.has(item)
            ? rebind.get(item)
            : rebindSceneLayerIds(item, rebind);
        changed ||= mapped !== item;
        next[key] = mapped;
    }
    return (changed ? next : value) as T;
}

/**
 * What a scene's stack needs so that rows brought into it from another scene still find their layers.
 *
 * Every layer of the source scene a row names (by id, anywhere in the row) comes along: a layer the
 * target already has under that id needs nothing; one it has under the same name is the same layer to
 * the stage, and the rows are pointed at the target's; any other is added to the target's stack at the
 * share it had, which puts it at the matching place among the target's own layers.
 */
export function sceneLayersForMovedRows(
    source: Pick<StoryScene, "layers">,
    target: Pick<StoryScene, "layers">,
    rows: readonly unknown[],
): { layers: StorySceneLayer[]; rebind: Map<string, string> } {
    const sourceStack = sceneLayerStack(source);
    let stack = sceneLayerStack(target);
    const rebind = new Map<string, string>();
    const named = new Set<string>();
    const collect = (value: unknown): void => {
        if (!value || typeof value !== "object") {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(collect);
            return;
        }
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (key === "sourceBlockId" && typeof item === "string") {
                named.add(item);
            } else {
                collect(item);
            }
        }
    };
    rows.forEach(collect);
    for (const layer of sourceStack) {
        if (layer.kind !== "custom" || !named.has(layer.id) || findCustomLayer(stack, layer.id)) {
            continue;
        }
        const sameName = findCustomLayerByName(stack, layer.name);
        if (sameName) {
            rebind.set(layer.id, sameName.id);
            continue;
        }
        stack = addSceneLayer(stack, { id: layer.id, name: layer.name });
        stack = setSceneLayerFollow(stack, stack.findIndex(entry => entry.kind === "custom" && entry.id === layer.id), sceneLayerFollow(layer));
    }
    return { layers: stack, rebind };
}
