import type { BlendResolution, PsdBakeTarget, PsdFingerprintSlot, PsdLayerNode, PsdLayerReference } from "@shared/types/psdImport";

/** A leaf of the PSD tree — the only thing that can become a Studio layer. */
export type PsdLeaf = PsdLayerReference & {
    name: string;
    blendMode: string;
    hidden: boolean;
    clipping: boolean;
    /** Top-level group this leaf sits under, or null when it sits at the document root. */
    group: string | null;
};

/**
 * Whether a blend mode is one the engine cannot reproduce.
 *
 * ag-psd spells a group's default "pass through" with a space, not "passThrough" — both are
 * accepted here so a leaf that somehow carries it is not mistaken for a real blend.
 */
export function isUnsupportedBlend(mode: string): boolean {
    const normalized = mode.replace(/\s+/g, "").toLowerCase();
    return normalized !== "normal" && normalized !== "passthrough";
}

export function joinPath(path: string[]): string {
    return path.join("/");
}

/** A collision-free key for a layer within one PSD, retaining ordinary name paths as written. */
export function psdLayerKey(ref: PsdLayerReference): string {
    const path = ref.path.map(part => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
    return ref.occurrence === undefined ? path : `${path}~2${ref.occurrence}`;
}

/** Copy the identity without adding undefined fields to a stored fingerprint. */
export function psdLayerReference(ref: PsdLayerReference): PsdLayerReference {
    return {
        path: ref.path,
        ...(ref.occurrence !== undefined ? { occurrence: ref.occurrence } : {}),
        ...(ref.sourceId !== undefined ? { sourceId: ref.sourceId } : {}),
    };
}

/** Match the imported leaves to distinct saved destinations, preferring unique PSD layer ids. */
export function matchPsdFingerprintSlots(
    slots: readonly PsdFingerprintSlot[],
    refs: readonly PsdLayerReference[],
): Map<string, PsdFingerprintSlot> {
    const pathKey = (ref: PsdLayerReference) => JSON.stringify(ref.path);
    const destination = (slot: PsdFingerprintSlot) => JSON.stringify([slot.layerId, slot.tagId ?? null]);
    const byPath = new Map<string, PsdFingerprintSlot[]>();
    const refsByPath = new Map<string, number>();
    const slotIds = new Map<number, number>();
    const refIds = new Map<number, number>();
    for (const slot of slots) {
        const path = pathKey(slot);
        byPath.set(path, [...(byPath.get(path) ?? []), slot]);
        if (slot.sourceId !== undefined) slotIds.set(slot.sourceId, (slotIds.get(slot.sourceId) ?? 0) + 1);
    }
    for (const ref of refs) {
        const path = pathKey(ref);
        refsByPath.set(path, (refsByPath.get(path) ?? 0) + 1);
        if (ref.sourceId !== undefined) refIds.set(ref.sourceId, (refIds.get(ref.sourceId) ?? 0) + 1);
    }

    const matches = new Map<string, PsdFingerprintSlot>();
    const claimed = new Set<string>();
    const idMatchedPaths = new Set<string>();
    const claim = (ref: PsdLayerReference, slot: PsdFingerprintSlot): boolean => {
        const key = psdLayerKey(ref);
        const target = destination(slot);
        if (matches.has(key) || claimed.has(target)) return false;
        matches.set(key, slot);
        claimed.add(target);
        return true;
    };
    const available = (slot: PsdFingerprintSlot) => !claimed.has(destination(slot));
    const compatible = (ref: PsdLayerReference, slot: PsdFingerprintSlot, pathSlots: PsdFingerprintSlot[]) => {
        if (ref.sourceId === undefined || slot.sourceId === undefined || ref.sourceId === slot.sourceId) return true;
        // A formerly unique path remains the reconnect key when a file's layer ids change.
        return ref.occurrence === undefined && slot.occurrence === undefined
            && pathSlots.length === 1 && refsByPath.get(pathKey(ref)) === 1;
    };

    for (const ref of refs) {
        if (ref.sourceId === undefined || refIds.get(ref.sourceId) !== 1 || slotIds.get(ref.sourceId) !== 1) continue;
        const slot = byPath.get(pathKey(ref))?.find(entry => entry.sourceId === ref.sourceId);
        if (slot && claim(ref, slot)) idMatchedPaths.add(pathKey(ref));
    }
    for (const ref of refs) {
        if (matches.has(psdLayerKey(ref)) || ref.occurrence === undefined) continue;
        const pathSlots = byPath.get(pathKey(ref)) ?? [];
        const slot = pathSlots.find(entry => entry.occurrence === ref.occurrence && available(entry)
            && compatible(ref, entry, pathSlots));
        if (slot) claim(ref, slot);
    }
    for (const ref of refs) {
        if (matches.has(psdLayerKey(ref))) continue;
        const pathSlots = byPath.get(pathKey(ref)) ?? [];
        const slot = pathSlots.find(entry => available(entry) && compatible(ref, entry, pathSlots)
            && (entry.occurrence === undefined || entry.occurrence === (ref.occurrence ?? 0)
                || (ref.occurrence !== undefined && idMatchedPaths.has(pathKey(ref)))));
        if (slot) claim(ref, slot);
    }
    return matches;
}

/** Every drawable layer, in stacking order (bottom first, the way both PSD and Studio store it). */
export function flattenLeaves(layers: PsdLayerNode[], group: string | null = null): PsdLeaf[] {
    const out: PsdLeaf[] = [];
    for (const node of layers) {
        if (node.children) {
            // Only the top level names an axis: a nested group is still art, not a second axis.
            out.push(...flattenLeaves(node.children, group ?? node.name));
            continue;
        }
        out.push({
            ...psdLayerReference(node),
            name: node.name,
            blendMode: node.blendMode,
            hidden: node.hidden,
            clipping: node.clipping,
            group,
        });
    }
    return out;
}

/**
 * The layers whose blend mode the engine cannot reproduce, and therefore the ones the author has to
 * decide about before anything is baked.
 *
 * `passThrough` is a group's default and means nothing for a leaf; everything else that is not
 * `normal` changes how the pixels combine, which a plain stack cannot do.
 */
export function unsupportedBlends(leaves: PsdLeaf[]): PsdLeaf[] {
    // A hidden layer is dropped whatever its blend mode, so asking the author about one would be
    // asking them to decide the fate of something that is not being imported either way.
    return leaves.filter(leaf => !leaf.hidden && isUnsupportedBlend(leaf.blendMode));
}

/**
 * Why a leaf did not become art.
 *
 * `clip-base-dropped` is Photoshop's own rule showing through: a clipped layer is only visible where
 * its base is, so when the base is not imported the clip has nothing to sit on. Importing it anyway
 * would turn a blush clipped to a face into a rectangle across the whole sprite, so it is left out —
 * but named, because silently losing art is the one thing this wizard must not do.
 */
export type PsdDropReason = "hidden" | "blend-skipped" | "clip-base-dropped";

/** A leaf flattened onto another rather than becoming a layer of its own. */
export type PsdAttachment = { leaf: PsdLeaf; clip: boolean };

/**
 * One layer the import will build, bottom first.
 *
 * The wizard renders this and the builder walks it, so what the author is shown and what is created
 * cannot drift apart.
 */
export type PlannedSlot =
    | { kind: "constant"; name: string; leaf: PsdLeaf }
    | { kind: "switch"; axis: string; options: { tag: string; leaf: PsdLeaf }[] };

export type ImportPlan = {
    /** Top-level group name → the axis it becomes. Groups with one layer are not axes. */
    axes: { name: string; tags: string[] }[];
    /** Leaves that become constant layers: no group, or a group that is not an axis. */
    constants: PsdLeaf[];
    /** Leaves that are actually going to be baked, after skips. */
    baking: PsdLeaf[];
    /** Leaves left out, with why. */
    dropped: { leaf: PsdLeaf; reason: PsdDropReason }[];
    /** The layers to build, in stack order. */
    slots: PlannedSlot[];
    /** Leaves flattened onto another, keyed by the identity of the layer they land on. */
    attachments: Record<string, PsdAttachment[]>;
};

/**
 * Turn a PSD tree plus the author's blend decisions into what Studio will build.
 *
 * The default mapping: a top-level group is an axis and the layers inside it are
 * its tags; a layer outside any group is a constant layer. A group holding a single layer is *not*
 * made an axis — a one-tag axis drives nothing and the engine would reject the empty group.
 *
 * Hidden layers are dropped rather than imported invisible: Photoshop hides work-in-progress, and an
 * imported layer nobody can see is indistinguishable from a bug.
 *
 * A clipped layer never becomes a layer or a tag of its own. Photoshop's clipping mask says it is
 * part of the layer beneath it — treating it as a sibling would both misplace the art and, inside a
 * group, invent a tag for something that was never a differential.
 */
export function planImport(leaves: PsdLeaf[], blendResolutions: Record<string, BlendResolution>): ImportPlan {
    const dropped: ImportPlan["dropped"] = [];
    const kept: PsdLeaf[] = [];
    const keptPaths = new Set<string>();
    for (const leaf of leaves) {
        if (leaf.hidden) {
            dropped.push({ leaf, reason: "hidden" });
            continue;
        }
        const unsupported = isUnsupportedBlend(leaf.blendMode);
        if (unsupported && blendResolutions[psdLayerKey(leaf)] === "skip") {
            dropped.push({ leaf, reason: "blend-skipped" });
            continue;
        }
        kept.push(leaf);
        keptPaths.add(psdLayerKey(leaf));
    }

    // What each clipped layer clips to: the nearest layer below that is not itself clipped, whether
    // or not it survived. Looking *past* a dropped base would silently move the art onto some other
    // layer, which is a worse outcome than leaving it out and saying so.
    const clipBase = new Map<string, PsdLeaf | null>();
    let beneath: PsdLeaf | null = null;
    for (const leaf of leaves) {
        if (leaf.clipping) {
            clipBase.set(psdLayerKey(leaf), beneath);
        } else {
            beneath = leaf;
        }
    }

    const attachments: Record<string, PsdAttachment[]> = Object.create(null);
    const bases: PsdLeaf[] = [];
    // Where a leaf's pixels end up. A leaf that is flattened onto another inherits that layer's host,
    // so a clip whose base was itself merged down still lands on real art instead of nowhere.
    const host = new Map<string, PsdLeaf>();
    const attach = (target: PsdLeaf, leaf: PsdLeaf, clip: boolean): void => {
        const key = psdLayerKey(target);
        attachments[key] = [...(attachments[key] ?? []), { leaf, clip }];
        // A leaf merged onto a whole group has several hosts; the first is the one anything clipped
        // to it follows, so the choice stays stable rather than depending on iteration order.
        if (!host.has(psdLayerKey(leaf))) {
            host.set(psdLayerKey(leaf), target);
        }
    };

    for (const leaf of kept) {
        if (leaf.clipping) {
            const base = clipBase.get(psdLayerKey(leaf)) ?? null;
            const target = base && keptPaths.has(psdLayerKey(base)) ? host.get(psdLayerKey(base)) : null;
            if (target) {
                attach(target, leaf, true);
            } else {
                dropped.push({ leaf, reason: "clip-base-dropped" });
            }
            continue;
        }
        if (isUnsupportedBlend(leaf.blendMode) && blendResolutions[psdLayerKey(leaf)] === "merge") {
            const below = bases[bases.length - 1];
            if (below) {
                // When the layer below belongs to a group, the merge lands on *every* member of it.
                // In Photoshop the shadow sits above the whole group and shows whichever tag is on;
                // attaching it to the topmost member alone would make the shadow disappear the
                // moment the author switched to any other tag. A group's leaves are contiguous, and
                // this leaf comes after all of them, so `bases` already holds the whole group.
                const group = below.group ? bases.filter(base => base.group === below.group) : [below];
                for (const target of group) {
                    attach(target, leaf, false);
                }
                continue;
            }
            // Nothing underneath to merge into: it becomes a plain layer of its own rather than
            // vanishing, which is the least surprising outcome for the bottom of the stack.
        }
        bases.push(leaf);
        host.set(psdLayerKey(leaf), leaf);
    }

    const byGroup = new Map<string, PsdLeaf[]>();
    for (const leaf of bases) {
        if (!leaf.group) continue;
        byGroup.set(leaf.group, [...(byGroup.get(leaf.group) ?? []), leaf]);
    }

    const axes = [...byGroup.entries()]
        .filter(([, members]) => members.length > 1)
        .map(([name, members]) => ({ name, tags: members.map(member => member.name) }));
    const axisNames = new Set(axes.map(axis => axis.name));

    // One slot per constant leaf, one per axis at the position its first member holds — so the
    // stack order the author sees is the order the art sits in.
    const slots: PlannedSlot[] = [];
    const emitted = new Set<string>();
    for (const leaf of bases) {
        if (leaf.group && axisNames.has(leaf.group)) {
            if (emitted.has(leaf.group)) continue;
            emitted.add(leaf.group);
            slots.push({
                kind: "switch",
                axis: leaf.group,
                options: (byGroup.get(leaf.group) ?? []).map(member => ({ tag: member.name, leaf: member })),
            });
            continue;
        }
        slots.push({ kind: "constant", name: leaf.name, leaf });
    }

    const droppedPaths = new Set(dropped.map(entry => psdLayerKey(entry.leaf)));
    return {
        axes,
        constants: bases.filter(leaf => !leaf.group || !axisNames.has(leaf.group)),
        baking: leaves.filter(leaf => !droppedPaths.has(psdLayerKey(leaf))),
        dropped,
        slots,
        attachments,
    };
}

/**
 * The blend modes Studio can flatten into pixels.
 *
 * Two families, both implemented from the W3C compositing spec in the worker's `blendModes.ts`:
 * per-channel ones, and the ones that mix channels together (hue/saturation/colour/luminosity, plus
 * Photoshop's whole-pixel darker/lighter colour).
 *
 * **This list must match `canMerge` in the worker.** It is duplicated because the wizard runs in the
 * renderer and the implementations run in a utility process, and the wizard has to grey out a choice
 * it could not keep before the author makes it — after the bake would be too late.
 *
 * What stays off the list is anything Studio cannot reproduce faithfully. `dissolve` is the one that
 * matters: it is stochastic and Photoshop's dither pattern is undocumented, so every bake would
 * differ. Those layers can only be skipped.
 */
export const MERGEABLE_BLEND_MODES: readonly string[] = [
    "normal", "multiply", "screen", "darken", "lighten", "linearBurn", "linearDodge",
    "colorBurn", "colorDodge", "overlay", "hardLight", "softLight", "difference", "exclusion",
    "hue", "saturation", "color", "luminosity", "darkerColor", "lighterColor",
];

export function canMergeBlendMode(mode: string): boolean {
    return MERGEABLE_BLEND_MODES.includes(mode);
}

/**
 * Above these, the wizard says out loud how big the import is going to be.
 *
 * Not a refusal — a sixty-layer sheet is a legitimate thing to import, and the author is the only
 * one who can judge it. The numbers are worth showing because both costs are invisible at the moment
 * of choosing: every layer becomes its own asset in the library, and every layer is baked to the
 * *full* canvas, so decoded memory is layers × canvas regardless of how little each one draws.
 */
export const IMPORT_LAYER_WARNING = 24;
export const IMPORT_MEGABYTE_WARNING = 256;

export type ImportCost = {
    /** Assets this import will add to the library. */
    layers: number;
    /** Decoded RGBA megabytes for the whole stack, which is what the character costs on stage. */
    megabytes: number;
    heavy: boolean;
};

export function estimateImportCost(plan: ImportPlan, canvas: { width: number; height: number }): ImportCost {
    const layers = plan.slots.reduce(
        (total, slot) => total + (slot.kind === "constant" ? 1 : slot.options.length),
        0,
    );
    const megabytes = Math.round((canvas.width * canvas.height * 4 * layers) / (1024 * 1024));
    return {
        layers,
        megabytes,
        heavy: layers > IMPORT_LAYER_WARNING || megabytes > IMPORT_MEGABYTE_WARNING,
    };
}

/**
 * What to bake, read straight off the plan.
 *
 * One bake target per slot entry — a constant layer, or one per tag of an axis — carrying whatever
 * the plan attached to it. Deriving this from the plan rather than re-reading the author's decisions
 * is what keeps the bake and the mapping the wizard displayed from drifting apart.
 */
export function toBakeTargets(plan: ImportPlan): PsdBakeTarget[] {
    const attachmentsFor = (leaf: PsdLeaf): PsdBakeTarget => {
        const attached = plan.attachments[psdLayerKey(leaf)] ?? [];
        return attached.length === 0
            ? psdLayerReference(leaf)
            : { ...psdLayerReference(leaf), mergeFrom: attached.map(entry => ({ ...psdLayerReference(entry.leaf), clip: entry.clip })) };
    };
    return plan.slots.flatMap(slot => (
        slot.kind === "constant"
            ? [attachmentsFor(slot.leaf)]
            : slot.options.map(option => attachmentsFor(option.leaf))
    ));
}
