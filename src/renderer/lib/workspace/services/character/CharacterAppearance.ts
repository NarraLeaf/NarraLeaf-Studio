import {
    CharacterAppearanceKind,
    CharacterAxis,
    CharacterLayer,
    CharacterNamed,
    CharacterPose,
    CharacterTagSelection,
    ICharacterAppearance,
    LayeredAppearance,
    PortraitCrop,
    PresetAppearance,
    ResolvedLayeredDefinition,
} from "./types";

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
    return kind === "layered"
        ? { kind: "layered", canvas: null, axes: [], layers: [] }
        : { kind: "preset", poses: [], defaultPoseId: null };
}

/** Defensive clone of a persisted appearance, tolerant of whatever the store actually holds. */
function cloneAppearance(appearance: ICharacterAppearance): ICharacterAppearance {
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
                options: layer.options ? { ...layer.options } : undefined,
            })),
        };
    }
    const preset = appearance as PresetAppearance;
    return {
        kind: "preset",
        poses: (preset?.poses ?? []).map(pose => ({ ...pose })),
        defaultPoseId: preset?.defaultPoseId ?? null,
    };
}

export class CharacterAppearance {
    private listeners: Set<() => void> = new Set();
    private assetChangeCallback: AssetChangeCallback | null = null;

    constructor(private appearance: ICharacterAppearance, private onChange: (() => void) | null = null) {
        if (!appearance || (appearance.kind !== "preset" && appearance.kind !== "layered")) {
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
        } else {
            for (const layer of this.appearance.layers) {
                if (layer.assetId) ids.add(layer.assetId);
                for (const assetId of Object.values(layer.options ?? {})) {
                    if (assetId) ids.add(assetId);
                }
            }
        }
        return [...ids];
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
        const pose: CharacterPose = { id: newId("p"), name, folder, assetId: null };
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
