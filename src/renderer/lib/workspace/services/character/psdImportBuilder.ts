import type { PsdBakeTarget, PsdFingerprintSlot } from "@shared/types/psdImport";
import { joinPath, type ImportPlan, type PsdLeaf } from "@shared/utils/psdLayerPlan";
import type { CharacterAppearance } from "./CharacterAppearance";

/** The asset a baked PSD layer became, by its layer path. */
export type BakedAssetLookup = (path: string[]) => string | null;

/** What a slot is called, for naming the baked files and therefore the assets. */
function slotLabels(plan: ImportPlan): Map<string, { slot: string; tag?: string }> {
    const labels = new Map<string, { slot: string; tag?: string }>();
    for (const slot of plan.slots) {
        if (slot.kind === "constant") {
            labels.set(joinPath(slot.leaf.path), { slot: slot.name });
            continue;
        }
        for (const option of slot.options) {
            labels.set(joinPath(option.leaf.path), { slot: slot.axis, tag: option.tag });
        }
    }
    return labels;
}

/**
 * Give each bake target the file name its asset should carry.
 *
 * The asset library names an asset after the file it imported, so without this a six-layer sheet
 * arrives as `000-Happy.png` … `005-Angry.png` and the author has to open each one to tell a mouth
 * from a pair of brows.
 */
export function nameBakeTargets(
    targets: PsdBakeTarget[],
    plan: ImportPlan,
    characterName: string,
): PsdBakeTarget[] {
    const labels = slotLabels(plan);
    const prefix = characterName.trim() || "character";
    return targets.map(target => {
        const label = labels.get(joinPath(target.path));
        if (!label) return target;
        return { ...target, name: [prefix, label.slot, label.tag].filter(Boolean).join("_") };
    });
}

/** Every leaf that becomes art of its own, which is one bake target each. */
function artLeaves(plan: ImportPlan): PsdLeaf[] {
    return plan.slots.flatMap(slot => (slot.kind === "constant" ? [slot.leaf] : slot.options.map(o => o.leaf)));
}

/**
 * How much of this import lands on layers that already exist.
 *
 * The wizard shows this before anything is baked, because "12 layers refreshed" and "12 layers
 * added" are very different things to be about to do to a character.
 */
export function summarisePlan(
    appearance: CharacterAppearance,
    plan: ImportPlan,
): { created: number; refreshed: number } {
    let refreshed = 0;
    for (const leaf of artLeaves(plan)) {
        if (appearance.findPsdSlot(leaf.path)) refreshed += 1;
    }
    return { created: artLeaves(plan).length - refreshed, refreshed };
}

/**
 * Build the plan into the character, and report where every PSD layer landed.
 *
 * Additive by construction: a layer the fingerprint still recognises has its image replaced, and
 * anything else is created. Nothing is deleted and nothing is renamed — a re-import must not undo
 * the author's own work on a stack they have since renamed, reordered and rebound, which is the
 * entire reason the mapping is remembered rather than the file.
 *
 * The returned slots become the new fingerprint, so the next import can do the same again.
 */
export function applyPsdPlan(
    appearance: CharacterAppearance,
    plan: ImportPlan,
    assetIdOf: BakedAssetLookup,
): PsdFingerprintSlot[] {
    const built: PsdFingerprintSlot[] = [];

    for (const slot of plan.slots) {
        if (slot.kind === "constant") {
            const existing = appearance.findPsdSlot(slot.leaf.path);
            const layerId = existing?.layerId ?? appearance.createLayer(slot.name)?.id;
            if (!layerId) continue;
            appearance.setLayerAsset(layerId, assetIdOf(slot.leaf.path));
            built.push({ path: slot.leaf.path, layerId });
            continue;
        }

        // Every tag of an axis feeds the same Studio layer, so any option that still reconnects
        // identifies the layer the whole group belongs to.
        const reconnected = slot.options
            .map(option => appearance.findPsdSlot(option.leaf.path))
            .find(hit => hit?.tagId);
        let layerId = reconnected?.layerId ?? null;
        let axisId = layerId ? appearance.getLayer(layerId)?.axisId ?? null : null;

        if (!layerId || !axisId) {
            axisId = appearance.createAxis(slot.axis)?.id ?? null;
            if (!axisId) continue;
            layerId = appearance.createLayer(slot.axis)?.id ?? null;
            if (!layerId) continue;
            appearance.setLayerAxis(layerId, axisId);
        }

        for (const option of slot.options) {
            const hit = appearance.findPsdSlot(option.leaf.path);
            // A tag added to the PSD since the last import is added to the axis rather than
            // ignored; `createTag` is what keeps every layer on the axis listing it too.
            const tagId = hit?.tagId ?? appearance.createTag(axisId, option.tag)?.id;
            if (!tagId) continue;
            appearance.setLayerOption(layerId, tagId, assetIdOf(option.leaf.path));
            built.push({ path: option.leaf.path, layerId, tagId });
        }
    }

    return built;
}
