import type { BlendResolution, PsdLayerNode } from "@shared/types/psdImport";

/** A leaf of the PSD tree — the only thing that can become a Studio layer. */
export type PsdLeaf = {
    path: string[];
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
            path: node.path,
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
    return leaves.filter(leaf => isUnsupportedBlend(leaf.blendMode));
}

export type ImportPlan = {
    /** Top-level group name → the axis it becomes. Groups with one layer are not axes. */
    axes: { name: string; tags: string[] }[];
    /** Leaves that become constant layers: no group, or a group that is not an axis. */
    constants: PsdLeaf[];
    /** Leaves that are actually going to be baked, after skips. */
    baking: PsdLeaf[];
    /** Leaves left out, with why. */
    dropped: { leaf: PsdLeaf; reason: "hidden" | "blend-skipped" }[];
};

/**
 * Turn a PSD tree plus the author's blend decisions into what Studio will build.
 *
 * The default mapping the plan asks for: a top-level group is an axis and the layers inside it are
 * its tags; a layer outside any group is a constant layer. A group holding a single layer is *not*
 * made an axis — a one-tag axis drives nothing and the engine would reject the empty group.
 *
 * Hidden layers are dropped rather than imported invisible: Photoshop hides work-in-progress, and an
 * imported layer nobody can see is indistinguishable from a bug.
 */
export function planImport(leaves: PsdLeaf[], blendResolutions: Record<string, BlendResolution>): ImportPlan {
    const dropped: ImportPlan["dropped"] = [];
    const kept: PsdLeaf[] = [];
    for (const leaf of leaves) {
        if (leaf.hidden) {
            dropped.push({ leaf, reason: "hidden" });
            continue;
        }
        const unsupported = isUnsupportedBlend(leaf.blendMode);
        if (unsupported && blendResolutions[joinPath(leaf.path)] === "skip") {
            dropped.push({ leaf, reason: "blend-skipped" });
            continue;
        }
        kept.push(leaf);
    }

    const byGroup = new Map<string, PsdLeaf[]>();
    for (const leaf of kept) {
        if (!leaf.group) continue;
        byGroup.set(leaf.group, [...(byGroup.get(leaf.group) ?? []), leaf]);
    }

    const axes = [...byGroup.entries()]
        .filter(([, members]) => members.length > 1)
        .map(([name, members]) => ({ name, tags: members.map(member => member.name) }));
    const axisNames = new Set(axes.map(axis => axis.name));

    return {
        axes,
        constants: kept.filter(leaf => !leaf.group || !axisNames.has(leaf.group)),
        baking: kept,
        dropped,
    };
}

/**
 * The blend modes Studio can flatten into pixels.
 *
 * Separable modes only — hue, saturation, colour and luminosity mix channels together, and a
 * subtly-wrong version of those would be worse than refusing them. A layer in one of those can be
 * skipped but not merged, and the wizard has to say so rather than offering a choice it cannot keep.
 * The implementations live in the worker; this list is what the UI needs.
 */
export const SEPARABLE_BLEND_MODES: readonly string[] = [
    "normal", "multiply", "screen", "darken", "lighten", "linearBurn", "linearDodge",
    "colorBurn", "colorDodge", "overlay", "hardLight", "softLight", "difference", "exclusion",
];

export function canMergeBlendMode(mode: string): boolean {
    return SEPARABLE_BLEND_MODES.includes(mode);
}

/**
 * What to bake, once the author's blend decisions are in.
 *
 * A merged layer is attached to the nearest kept layer *below* it, which is what "merge down" means
 * in Photoshop and the only reading that survives an engine which just stacks.
 */
export function toBakeTargets(
    plan: ImportPlan,
    blendResolutions: Record<string, BlendResolution>,
): { path: string[]; mergeFrom?: string[][] }[] {
    const targets: { path: string[]; mergeFrom?: string[][] }[] = [];
    for (const leaf of plan.baking) {
        const unsupported = isUnsupportedBlend(leaf.blendMode);
        if (unsupported && blendResolutions[joinPath(leaf.path)] === "merge") {
            const below = targets[targets.length - 1];
            if (below) {
                below.mergeFrom = [...(below.mergeFrom ?? []), leaf.path];
                continue;
            }
            // Nothing underneath to merge into: it becomes a plain layer of its own rather than
            // vanishing, which is the least surprising outcome for the bottom of the stack.
        }
        targets.push({ path: leaf.path });
    }
    return targets;
}
