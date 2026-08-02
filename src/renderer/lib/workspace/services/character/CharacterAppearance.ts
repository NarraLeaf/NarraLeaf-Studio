import {
    CharacterAppearanceKind,
    isCharacterAppearanceKind,
    isPuppetAppearance,
    isPuppetAppearanceKind,
    CharacterAvatarEntry,
    CharacterAvatarTable,
    CharacterAxis,
    CharacterLayer,
    CharacterNamed,
    CharacterPose,
    CharacterSnapshot,
    CharacterTagSelection,
    ICharacterAppearance,
    LayeredAppearance,
    PortraitCrop,
    PresetAppearance,
    PuppetAppearance,
    PuppetDefaultState,
    ResolvedLayeredDefinition,
} from "./types";
import type { PsdFingerprint } from "@shared/types/psdImport";
import { knownPuppetRuntimeFor } from "@shared/utils/puppetRuntimes";

export type AssetChangeCallback = (oldAssetId: string | null, newAssetId: string | null) => void;

let idCounter = 0;

/**
 * Ids are per-character rather than global, and are the strings handed to the engine as tags — so
 * they only have to be unique within one character and stable across renames. A short prefixed
 * counter satisfies both and stays readable in a diff of the character store.
 */
function newId(prefix: string): string {
    idCounter += 1;
    const salt = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
    return `${prefix}${idCounter.toString(36)}${salt}`;
}

export function emptyAppearance(kind: CharacterAppearanceKind): ICharacterAppearance {
    if (kind === "layered") {
        return { kind: "layered", canvas: null, axes: [], layers: [], snapshots: [] };
    }
    if (isPuppetAppearanceKind(kind)) {
        return {
            kind,
            assetId: null,
            // A named kind knows which runtime it wants, so it starts pointed at that runtime's
            // conventional folder instead of making the author type it. `puppet` — the kind for a
            // runtime the author wrote — has no name to guess and starts empty.
            backend: knownPuppetRuntimeFor(kind)?.backend ?? "",
            entry: null,
            size: null,
            options: {},
        };
    }
    return { kind: "preset", poses: [], defaultPoseId: null };
}

/**
 * A resting pose, or null when there is nothing to record.
 *
 * All three fields cleared is the same state as no `defaultState` at all, and collapsing it keeps
 * the store free of `{motion: null, expression: null, skin: null}` for every puppet character that
 * never had one.
 */
export function normalizePuppetDefaultState(state: unknown): PuppetDefaultState | null {
    if (typeof state !== "object" || state === null) {
        return null;
    }
    const raw = state as Partial<Record<keyof PuppetDefaultState, unknown>>;
    const field = (value: unknown): string | null =>
        (typeof value === "string" && value.trim()) ? value.trim() : null;
    const normalized: PuppetDefaultState = {
        motion: field(raw.motion),
        expression: field(raw.expression),
        skin: field(raw.skin),
    };
    return normalized.motion || normalized.expression || normalized.skin ? normalized : null;
}

function cloneAvatars(avatars: CharacterAvatarTable | undefined): CharacterAvatarTable | undefined {
    if (!avatars) {
        return undefined;
    }
    const cloned: CharacterAvatarTable = {};
    for (const [key, entry] of Object.entries(avatars)) {
        cloned[key] = { ...entry };
    }
    return cloned;
}

/**
 * Defensive clone of a persisted appearance, tolerant of whatever the store actually holds.
 *
 * This names every field on purpose (rather than deep-copying) so a malformed store cannot smuggle
 * shapes past it — which also means **anything added to the model has to be added here**, or it is
 * silently dropped on the next save.
 */
function cloneAppearance(appearance: ICharacterAppearance): ICharacterAppearance {
    if (isPuppetAppearance(appearance)) {
        const puppet = appearance;
        const width = Number(puppet.size?.width);
        const height = Number(puppet.size?.height);
        return {
            // Carried through rather than written as a literal: the three puppet kinds share this
            // whole arm, and collapsing them here would silently retype every Live2D character as a
            // generic one on the next save.
            kind: puppet.kind,
            assetId: puppet.assetId ?? null,
            backend: typeof puppet.backend === "string" ? puppet.backend : "",
            entry: puppet.entry ?? null,
            // A zero or non-finite box would reach the engine as a real size and collapse the
            // element, where `null` means "the stage" — so a malformed one degrades to the default.
            size: Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
                ? { width, height }
                : null,
            // Opaque by contract: cloned one level, never inspected. A backend's options are its
            // own vocabulary and Studio has no business knowing a key of it.
            options: { ...(puppet.options ?? {}) },
            // Absent rather than a triple of nulls when nothing is set, so a character the author
            // never gave a resting pose carries no extra state into the store at all.
            ...(normalizePuppetDefaultState(puppet.defaultState)
                ? { defaultState: normalizePuppetDefaultState(puppet.defaultState)! }
                : {}),
        };
    }
    if (appearance?.kind === "layered") {
        return {
            kind: "layered",
            canvas: appearance.canvas ? { ...appearance.canvas } : null,
            axes: (appearance.axes ?? []).map(axis => ({
                id: axis.id,
                name: axis.name,
                tags: (axis.tags ?? []).map(tag => ({ ...tag })),
                defaultTagId: axis.defaultTagId ?? null,
            })),
            layers: (appearance.layers ?? []).map(layer => ({
                id: layer.id,
                name: layer.name,
                axisId: layer.axisId ?? null,
                assetId: layer.assetId ?? null,
                // Spread in, never assigned as `undefined`: this clone is what gets written, and the
                // canonical encoder throws on an `undefined` property rather than dropping it. An
                // unbound layer carries no `options` key at all, which is also what `setLayerAxis`
                // leaves behind when it unbinds one (`delete layer.options`).
                ...(layer.options ? { options: { ...layer.options } } : {}),
            })),
            snapshots: (appearance.snapshots ?? []).map(snapshot => ({
                id: snapshot.id,
                name: snapshot.name,
                tags: { ...snapshot.tags },
            })),
            ...(appearance.psd
                ? {
                    psd: {
                        ...appearance.psd,
                        slots: (appearance.psd.slots ?? []).map(slot => ({ ...slot, path: [...slot.path] })),
                    },
                }
                : {}),
            ...(appearance.avatarAxisIds ? { avatarAxisIds: [...appearance.avatarAxisIds] } : {}),
            ...(appearance.avatars ? { avatars: cloneAvatars(appearance.avatars) } : {}),
        };
    }
    const preset = appearance as PresetAppearance;
    return {
        kind: "preset",
        poses: (preset?.poses ?? []).map(pose => ({ ...pose })),
        defaultPoseId: preset?.defaultPoseId ?? null,
        ...(preset?.avatars ? { avatars: cloneAvatars(preset.avatars) } : {}),
    };
}

export class CharacterAppearance {
    private listeners: Set<() => void> = new Set();
    private assetChangeCallback: AssetChangeCallback | null = null;

    constructor(private appearance: ICharacterAppearance, private onChange: (() => void) | null = null) {
        if (!appearance || !isCharacterAppearanceKind(appearance.kind)) {
            this.appearance = emptyAppearance("preset");
        }
    }

    public setOnChange(handler: (() => void) | null): void {
        this.onChange = handler;
    }

    public setOnAssetChange(handler: AssetChangeCallback | null): void {
        this.assetChangeCallback = handler;
    }

    public subscribe(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    private notifyChange(): void {
        if (this.onChange) {
            this.onChange();
        }
        this.listeners.forEach(listener => listener());
    }

    private notifyAssetChange(oldAssetId: string | null, newAssetId: string | null): void {
        if (oldAssetId === newAssetId) {
            return;
        }
        if (this.assetChangeCallback) {
            this.assetChangeCallback(oldAssetId, newAssetId);
        }
    }

    /** Serialize for persistence/export. */
    public toJSON(): ICharacterAppearance {
        return cloneAppearance(this.appearance);
    }

    public getKind(): CharacterAppearanceKind {
        return this.appearance.kind;
    }

    /**
     * Cold-switch the sprite kind. The two kinds share no data — a stack cannot be inferred from
     * finished sprites, and flattening a stack is a render rather than a conversion — so switching
     * *discards* the current appearance instead of translating it (user ruling 2026-07-26). Callers
     * are responsible for confirming with the author and for reporting the story rows the discarded
     * ids leave dangling.
     */
    public setKind(kind: CharacterAppearanceKind): void {
        if (this.appearance.kind === kind) {
            return;
        }
        for (const assetId of this.listAssetIds()) {
            this.notifyAssetChange(assetId, null);
        }
        this.appearance = emptyAppearance(kind);
        this.notifyChange();
    }

    /** Every asset this appearance references, deduplicated. Drives locking and the reference graph. */
    public listAssetIds(): string[] {
        const ids = new Set<string>();
        if (this.appearance.kind === "preset") {
            for (const pose of this.appearance.poses) {
                if (pose.assetId) ids.add(pose.assetId);
            }
        } else if (isPuppetAppearance(this.appearance)) {
            if (this.appearance.assetId) ids.add(this.appearance.assetId);
        } else {
            for (const layer of this.appearance.layers) {
                if (layer.assetId) ids.add(layer.assetId);
                for (const assetId of Object.values(layer.options ?? {})) {
                    if (assetId) ids.add(assetId);
                }
            }
        }
        // Hand-drawn avatar overrides are ordinary library assets and must be locked like any other.
        // The bakes are not: they are derived project files addressed by a synthetic id, and they
        // have no record in the asset library to reference.
        for (const entry of Object.values(this.getAvatars())) {
            if (entry.overrideAssetId) ids.add(entry.overrideAssetId);
        }
        return [...ids];
    }

    // ---------------------------------------------------------------- avatars

    /**
     * Every differential's dialog avatar, keyed by avatar key. The two image-backed kinds carry the
     * same table; a puppet has no differentials to key one on — what it is doing is runtime state
     * the backend names — so it carries none, and its avatar is the profile's `defaultAvatarAssetId`.
     */
    public getAvatars(): CharacterAvatarTable {
        return (isPuppetAppearance(this.appearance) ? undefined : this.appearance.avatars) ?? {};
    }

    public getAvatar(key: string): CharacterAvatarEntry | null {
        return this.getAvatars()[key] ?? null;
    }

    /**
     * Write one differential's avatar record, or drop it when nothing is left to remember. Dropping
     * matters: an empty entry would otherwise tell the compiler a bake exists for a key whose PNG
     * the baker just deleted.
     */
    public setAvatar(key: string, entry: CharacterAvatarEntry | null): void {
        if (!key || isPuppetAppearance(this.appearance)) return;
        const avatars = { ...this.getAvatars() };
        // `portrait` counts as something to remember. It was left out once and the symptom was a
        // crop that appeared to save and was gone on reopen: an entry carrying only a crop looked
        // empty to this check and was deleted on the way out.
        const next = entry && (entry.baked || entry.overrideAssetId || entry.portrait) ? { ...entry } : null;
        if (next) {
            avatars[key] = next;
        } else {
            delete avatars[key];
        }
        this.appearance.avatars = avatars;
        this.notifyChange();
    }

    /**
     * Frame one differential, or clear it back to the character-wide crop with `null`.
     *
     * Merges rather than replaces: the bake fingerprint and any hand-drawn override on the same key
     * must survive a reframing, and vice versa.
     */
    public setAvatarPortrait(key: string, portrait: PortraitCrop | null): void {
        if (!key || isPuppetAppearance(this.appearance)) return;
        const current = this.getAvatar(key);
        const next: CharacterAvatarEntry = { ...(current ?? {}) };
        if (portrait) {
            next.portrait = { ...portrait };
        } else {
            delete next.portrait;
        }
        this.setAvatar(key, next);
    }

    /** The crop written for this differential, if the author framed this one specifically. */
    public getAvatarPortrait(key: string): PortraitCrop | null {
        return this.getAvatar(key)?.portrait ?? null;
    }

    /** Which axes a layered character's avatar varies with. Empty means every axis (see the model). */
    public getAvatarAxisIds(): string[] {
        return this.layered?.avatarAxisIds ?? [];
    }

    public setAvatarAxisIds(axisIds: string[] | null): void {
        const layered = this.layered;
        if (!layered) return;
        const valid = (axisIds ?? []).filter(axisId => layered.axes.some(axis => axis.id === axisId));
        if (valid.length > 0) {
            layered.avatarAxisIds = valid;
        } else {
            delete layered.avatarAxisIds;
        }
        this.notifyChange();
    }

    // ---------------------------------------------------------------- preset

    private get preset(): PresetAppearance | null {
        return this.appearance.kind === "preset" ? this.appearance : null;
    }

    public getPoses(): CharacterPose[] {
        return this.preset?.poses ?? [];
    }

    public getPose(poseId: string): CharacterPose | null {
        return this.preset?.poses.find(pose => pose.id === poseId) ?? null;
    }

    public getDefaultPoseId(): string | null {
        const preset = this.preset;
        if (!preset) return null;
        const declared = preset.defaultPoseId;
        const valid = declared && preset.poses.some(pose => pose.id === declared) ? declared : null;
        return valid ?? preset.poses[0]?.id ?? null;
    }

    public setDefaultPoseId(poseId: string | null): void {
        const preset = this.preset;
        if (!preset) return;
        preset.defaultPoseId = poseId;
        this.notifyChange();
    }

    public createPose(name: string, folder?: string): CharacterPose | null {
        const preset = this.preset;
        if (!preset) return null;
        // `folder` is optional and is left OUT when there is none - `folder: folder` wrote the key
        // as `undefined` for every pose created outside a folder, which the canonical encoder
        // refuses. Same rule as `setPoseFolder`, which already deletes rather than clears.
        const pose: CharacterPose = { id: newId("p"), name, ...(folder ? { folder } : {}), assetId: null };
        preset.poses.push(pose);
        if (!preset.defaultPoseId) {
            preset.defaultPoseId = pose.id;
        }
        this.notifyChange();
        return pose;
    }

    public removePose(poseId: string): boolean {
        const preset = this.preset;
        if (!preset) return false;
        const index = preset.poses.findIndex(pose => pose.id === poseId);
        if (index === -1) return false;
        const [removed] = preset.poses.splice(index, 1);
        this.notifyAssetChange(removed.assetId ?? null, null);
        if (preset.defaultPoseId === poseId) {
            preset.defaultPoseId = preset.poses[0]?.id ?? null;
        }
        this.notifyChange();
        return true;
    }

    public setPoseAsset(poseId: string, assetId: string | null): void {
        const pose = this.getPose(poseId);
        if (!pose) return;
        this.notifyAssetChange(pose.assetId ?? null, assetId);
        pose.assetId = assetId;
        this.notifyChange();
    }

    public setPoseFolder(poseId: string, folder: string | undefined): void {
        const pose = this.getPose(poseId);
        if (!pose) return;
        if (folder) {
            pose.folder = folder;
        } else {
            delete pose.folder;
        }
        this.notifyChange();
    }

    public setPosePortrait(poseId: string, portrait: PortraitCrop | undefined): void {
        const pose = this.getPose(poseId);
        if (!pose) return;
        if (portrait) {
            pose.portrait = portrait;
        } else {
            delete pose.portrait;
        }
        this.notifyChange();
    }

    /**
     * The asset a pose selection resolves to, or null. A named pose that has no asset resolves to
     * null rather than to some other pose's image: the old model's "any entry will do" fallback is
     * what made a missing differential look like a working one.
     */
    public resolvePoseAssetId(poseId: string | undefined | null): string | null {
        const pose = poseId ? this.getPose(poseId) : this.getPose(this.getDefaultPoseId() ?? "");
        return pose?.assetId ?? null;
    }

    // ---------------------------------------------------------------- puppet

    /** The puppet declaration, or null when this character is not one. */
    public getPuppet(): PuppetAppearance | null {
        return isPuppetAppearance(this.appearance) ? this.appearance : null;
    }

    /** The model bundle this puppet draws. */
    public setPuppetAsset(assetId: string | null): void {
        const puppet = this.getPuppet();
        if (!puppet) return;
        this.notifyAssetChange(puppet.assetId, assetId);
        puppet.assetId = assetId;
        this.notifyChange();
    }

    /**
     * The registered backend that draws it. Free text rather than a checked reference: the runtime
     * is a directory the author drops into their project and may not be installed on the machine
     * the story is being written on. A name nothing answers to degrades to an empty box at runtime
     * (the engine's own behaviour), which is the honest outcome for "the renderer is not here".
     */
    public setPuppetBackend(backend: string): void {
        const puppet = this.getPuppet();
        if (!puppet) return;
        puppet.backend = backend.trim();
        this.notifyChange();
    }

    public setPuppetEntry(entry: string | null): void {
        const puppet = this.getPuppet();
        if (!puppet) return;
        const trimmed = entry?.trim() ?? "";
        puppet.entry = trimmed || null;
        this.notifyChange();
    }

    /** The stage box, or null for the stage size. */
    public setPuppetSize(size: { width: number; height: number } | null): void {
        const puppet = this.getPuppet();
        if (!puppet) return;
        puppet.size = size && size.width > 0 && size.height > 0
            ? { width: size.width, height: size.height }
            : null;
        this.notifyChange();
    }

    /** The pose this character rests in. Reads {@link PuppetDefaultState} for what `null` means. */
    public getPuppetDefaultState(): PuppetDefaultState {
        // Normalized on read rather than trusted: the live appearance object is whatever the store
        // held, and a number where a motion name belongs would reach a `<Select>` as its value.
        return normalizePuppetDefaultState(this.getPuppet()?.defaultState)
            ?? { motion: null, expression: null, skin: null };
    }

    /** Set one field of the resting pose. An empty string clears it, which is not the same as leaving it. */
    public setPuppetDefaultState(field: keyof PuppetDefaultState, value: string | null): void {
        const puppet = this.getPuppet();
        if (!puppet) return;
        const next = { ...this.getPuppetDefaultState(), [field]: value?.trim() || null };
        const normalized = normalizePuppetDefaultState(next);
        if (normalized) {
            puppet.defaultState = normalized;
        } else {
            delete puppet.defaultState;
        }
        this.notifyChange();
    }

    /** Replace the whole options object. Passed to the backend verbatim; never read here. */
    public setPuppetOptions(options: Record<string, unknown>): void {
        const puppet = this.getPuppet();
        if (!puppet) return;
        puppet.options = { ...options };
        this.notifyChange();
    }

    // --------------------------------------------------------------- layered

    private get layered(): LayeredAppearance | null {
        return this.appearance.kind === "layered" ? this.appearance : null;
    }

    public getCanvas(): { width: number; height: number } | null {
        return this.layered?.canvas ?? null;
    }

    public setCanvas(canvas: { width: number; height: number } | null): void {
        const layered = this.layered;
        if (!layered) return;
        layered.canvas = canvas ? { ...canvas } : null;
        this.notifyChange();
    }

    public getAxes(): CharacterAxis[] {
        return this.layered?.axes ?? [];
    }

    public getAxis(axisId: string): CharacterAxis | null {
        return this.layered?.axes.find(axis => axis.id === axisId) ?? null;
    }

    public getLayers(): CharacterLayer[] {
        return this.layered?.layers ?? [];
    }

    public getLayer(layerId: string): CharacterLayer | null {
        return this.layered?.layers.find(layer => layer.id === layerId) ?? null;
    }

    public createAxis(name: string): CharacterAxis | null {
        const layered = this.layered;
        if (!layered) return null;
        const axis: CharacterAxis = { id: newId("x"), name, tags: [], defaultTagId: null };
        layered.axes.push(axis);
        this.notifyChange();
        return axis;
    }

    public removeAxis(axisId: string): boolean {
        const layered = this.layered;
        if (!layered) return false;
        const index = layered.axes.findIndex(axis => axis.id === axisId);
        if (index === -1) return false;
        layered.axes.splice(index, 1);
        // Layers bound to it fall back to constant, releasing their per-tag assets.
        for (const layer of layered.layers) {
            if (layer.axisId !== axisId) continue;
            for (const assetId of Object.values(layer.options ?? {})) {
                this.notifyAssetChange(assetId ?? null, null);
            }
            layer.axisId = null;
            delete layer.options;
        }
        this.notifyChange();
        return true;
    }

    /**
     * Add a tag to an axis, and give every layer on that axis an entry for it. The completeness of
     * `options` is the invariant that keeps one engine group driving all of them.
     */
    public createTag(axisId: string, name: string): CharacterNamed | null {
        const layered = this.layered;
        const axis = this.getAxis(axisId);
        if (!layered || !axis) return null;
        const tag: CharacterNamed = { id: newId("t"), name };
        axis.tags.push(tag);
        if (!axis.defaultTagId) {
            axis.defaultTagId = tag.id;
        }
        for (const layer of layered.layers) {
            if (layer.axisId === axisId) {
                layer.options = { ...(layer.options ?? {}), [tag.id]: null };
            }
        }
        this.notifyChange();
        return tag;
    }

    /** Remove a tag, and shrink every bound layer's `options` with it (the same invariant). */
    public removeTag(axisId: string, tagId: string): boolean {
        const layered = this.layered;
        const axis = this.getAxis(axisId);
        if (!layered || !axis) return false;
        const index = axis.tags.findIndex(tag => tag.id === tagId);
        if (index === -1) return false;
        axis.tags.splice(index, 1);
        for (const layer of layered.layers) {
            if (layer.axisId !== axisId || !layer.options) continue;
            this.notifyAssetChange(layer.options[tagId] ?? null, null);
            delete layer.options[tagId];
        }
        if (axis.defaultTagId === tagId) {
            axis.defaultTagId = axis.tags[0]?.id ?? null;
        }
        this.notifyChange();
        return true;
    }

    public setAxisDefaultTag(axisId: string, tagId: string | null): void {
        const axis = this.getAxis(axisId);
        if (!axis) return;
        axis.defaultTagId = tagId;
        this.notifyChange();
    }

    /** Rename anything named. Ids are what everything else stores, so this rewrites nothing. */
    public rename(target: CharacterNamed | null, name: string): boolean {
        const normalized = name.trim();
        if (!target || !normalized) return false;
        target.name = normalized;
        this.notifyChange();
        return true;
    }

    public createLayer(name: string, axisId: string | null = null): CharacterLayer | null {
        const layered = this.layered;
        if (!layered) return null;
        const layer: CharacterLayer = { id: newId("l"), name, axisId: null, assetId: null };
        layered.layers.push(layer);
        if (axisId) {
            this.setLayerAxis(layer.id, axisId);
        }
        this.notifyChange();
        return layer;
    }

    public removeLayer(layerId: string): boolean {
        const layered = this.layered;
        if (!layered) return false;
        const index = layered.layers.findIndex(layer => layer.id === layerId);
        if (index === -1) return false;
        const [removed] = layered.layers.splice(index, 1);
        this.notifyAssetChange(removed.assetId ?? null, null);
        for (const assetId of Object.values(removed.options ?? {})) {
            this.notifyAssetChange(assetId ?? null, null);
        }
        this.notifyChange();
        return true;
    }

    /** Move a layer within the stack. Index 0 is the bottom, matching the stored order. */
    public moveLayer(layerId: string, toIndex: number): boolean {
        const layered = this.layered;
        if (!layered) return false;
        const from = layered.layers.findIndex(layer => layer.id === layerId);
        if (from === -1) return false;
        const to = Math.max(0, Math.min(layered.layers.length - 1, toIndex));
        if (from === to) return false;
        const [layer] = layered.layers.splice(from, 1);
        layered.layers.splice(to, 0, layer);
        this.notifyChange();
        return true;
    }

    /**
     * Bind a layer to an axis, or to none. Binding seeds `options` with an entry per tag of that
     * axis; unbinding drops them. Either way the layer's previous assets are released — a constant
     * layer's image means nothing once the layer varies, and vice versa.
     */
    public setLayerAxis(layerId: string, axisId: string | null): void {
        const layer = this.getLayer(layerId);
        if (!layer || layer.axisId === axisId) return;

        this.notifyAssetChange(layer.assetId ?? null, null);
        for (const assetId of Object.values(layer.options ?? {})) {
            this.notifyAssetChange(assetId ?? null, null);
        }
        layer.assetId = null;

        const axis = axisId ? this.getAxis(axisId) : null;
        if (axis) {
            layer.axisId = axis.id;
            layer.options = Object.fromEntries(axis.tags.map(tag => [tag.id, null]));
        } else {
            layer.axisId = null;
            delete layer.options;
        }
        this.notifyChange();
    }

    /** Set a constant layer's asset. */
    public setLayerAsset(layerId: string, assetId: string | null): void {
        const layer = this.getLayer(layerId);
        if (!layer || layer.axisId) return;
        this.notifyAssetChange(layer.assetId ?? null, assetId);
        layer.assetId = assetId;
        this.notifyChange();
    }

    /** Set what a bound layer draws for one tag. `null` means it draws nothing for that tag. */
    public setLayerOption(layerId: string, tagId: string, assetId: string | null): void {
        const layer = this.getLayer(layerId);
        if (!layer || !layer.axisId) return;
        const axis = this.getAxis(layer.axisId);
        if (!axis?.tags.some(tag => tag.id === tagId)) return;
        const options = layer.options ?? {};
        this.notifyAssetChange(options[tagId] ?? null, assetId);
        layer.options = { ...options, [tagId]: assetId };
        this.notifyChange();
    }

    /** The PSD this stack came from, or null if it was built by hand. */
    public getPsdFingerprint(): PsdFingerprint | null {
        return this.layered?.psd ?? null;
    }

    public setPsdFingerprint(fingerprint: PsdFingerprint | null): void {
        const layered = this.layered;
        if (!layered) return;
        if (fingerprint) {
            layered.psd = fingerprint;
        } else {
            delete layered.psd;
        }
        this.notifyChange();
    }

    /**
     * Where a PSD layer went last time, if it is still there.
     *
     * A re-import asks this for every layer it is about to build. A hit means "refresh this slot's
     * image" and leaves the author's renames, stack order and axis bindings untouched; a miss means
     * the layer is new. Slots whose layer or tag has since been deleted read as misses, which is why
     * the ids are checked against the appearance rather than trusted.
     */
    public findPsdSlot(path: string[]): { layerId: string; tagId?: string } | null {
        const joined = path.join("/");
        const slot = this.getPsdFingerprint()?.slots.find(entry => entry.path.join("/") === joined);
        if (!slot) return null;
        const layer = this.getLayer(slot.layerId);
        if (!layer) return null;
        if (!slot.tagId) {
            return layer.axisId ? null : { layerId: slot.layerId };
        }
        const axis = layer.axisId ? this.getAxis(layer.axisId) : null;
        return axis?.tags.some(tag => tag.id === slot.tagId) ? { layerId: slot.layerId, tagId: slot.tagId } : null;
    }

    public getSnapshots(): CharacterSnapshot[] {
        return this.layered?.snapshots ?? [];
    }

    /**
     * Name the combination currently being looked at. The selection is resolved first, so a snapshot
     * always names a complete look rather than a partial one that would drift when a default changes.
     */
    public createSnapshot(name: string, tags: CharacterTagSelection): CharacterSnapshot | null {
        const layered = this.layered;
        if (!layered) return null;
        const snapshot: CharacterSnapshot = { id: newId("s"), name, tags: this.resolveTagSelection(tags) };
        layered.snapshots = [...(layered.snapshots ?? []), snapshot];
        this.notifyChange();
        return snapshot;
    }

    public removeSnapshot(snapshotId: string): boolean {
        const layered = this.layered;
        if (!layered?.snapshots) return false;
        const index = layered.snapshots.findIndex(snapshot => snapshot.id === snapshotId);
        if (index === -1) return false;
        layered.snapshots.splice(index, 1);
        this.notifyChange();
        return true;
    }

    /** Every axis's default tag, keyed by axis id. An axis with no tags contributes nothing. */
    public defaultTagSelection(): CharacterTagSelection {
        const selection: CharacterTagSelection = {};
        for (const axis of this.getAxes()) {
            const declared = axis.defaultTagId;
            const valid = declared && axis.tags.some(tag => tag.id === declared) ? declared : null;
            const tagId = valid ?? axis.tags[0]?.id;
            if (tagId) {
                selection[axis.id] = tagId;
            }
        }
        return selection;
    }

    /**
     * Fill a partial selection out to every axis. A partial selection is what a `/face` row stores —
     * it names only the axes the author touched — while `/show` has to pose the whole character.
     */
    public resolveTagSelection(partial: CharacterTagSelection | undefined): CharacterTagSelection {
        const resolved = this.defaultTagSelection();
        for (const [axisId, tagId] of Object.entries(partial ?? {})) {
            const axis = this.getAxis(axisId);
            if (axis?.tags.some(tag => tag.id === tagId)) {
                resolved[axisId] = tagId;
            }
        }
        return resolved;
    }

    /**
     * What this character draws under one selection, bottom to top: asset ids, `null` for a slot that
     * draws nothing. A preset character is a one-slot stack, which is what lets the compositor and the
     * preview treat both kinds the same way.
     *
     * Partial tag selections are filled out first — a `/face` row names only the axes it touched.
     */
    public resolveDrawList(selection: { poseId?: string | null; tags?: CharacterTagSelection | null }): (string | null)[] {
        if (this.appearance.kind === "preset") {
            return [this.resolvePoseAssetId(selection.poseId)];
        }
        // A puppet draws no images at all — its interior is a backend's business, and Studio has no
        // way to render one outside a running game. Empty rather than a placeholder slot: every
        // caller treats an entry as "an image belongs here", and a puppet has none.
        if (isPuppetAppearance(this.appearance)) {
            return [];
        }
        const tags = this.resolveTagSelection(selection.tags ?? undefined);
        return this.getLayers().map(layer => (
            layer.axisId ? layer.options?.[tags[layer.axisId] ?? ""] ?? null : layer.assetId ?? null
        ));
    }

    /**
     * Render the stack into the engine's layered src. A layer bound to an axis becomes a variants
     * map keyed by tag id; the engine derives one group per distinct tag *set*, so every layer on
     * the same axis collapses onto that axis's single group — which is what makes one tag move them
     * all, and why {@link createTag} keeps `options` complete.
     *
     * A constant layer whose asset does not resolve is dropped rather than emitted as a hole, and a
     * bound layer is skipped when its axis has no tags: it would otherwise contribute an empty
     * group, which the engine rejects.
     *
     * Editor visibility is deliberately not consulted. Hiding a layer while working on the one under
     * it must not change what ships, so that toggle lives in the editor's own state and never reaches
     * here (user ruling 2026-07-26).
     */
    public toLayeredDefinition(resolveAssetUrl: (assetId: string) => string | null): ResolvedLayeredDefinition | null {
        const layered = this.layered;
        if (!layered) return null;

        const layers: ResolvedLayeredDefinition["layers"] = [];
        for (const layer of layered.layers) {
            if (!layer.axisId) {
                const url = layer.assetId ? resolveAssetUrl(layer.assetId) : null;
                if (url) {
                    layers.push(url);
                }
                continue;
            }
            const axis = this.getAxis(layer.axisId);
            if (!axis || axis.tags.length === 0) continue;
            const variants: Record<string, string | null> = {};
            for (const tag of axis.tags) {
                const assetId = layer.options?.[tag.id] ?? null;
                variants[tag.id] = assetId ? resolveAssetUrl(assetId) : null;
            }
            layers.push(variants);
        }

        // One default per group that actually reached the stack. A default naming a group no layer
        // emitted is a tag the engine has never heard of, and it rejects those outright.
        const emitted = new Set(
            layers.flatMap(layer => (typeof layer === "object" && layer !== null ? Object.keys(layer) : [])),
        );
        const defaults = Object.values(this.defaultTagSelection()).filter(tagId => emitted.has(tagId));

        return layers.length > 0 ? { layers, defaults } : null;
    }
}
