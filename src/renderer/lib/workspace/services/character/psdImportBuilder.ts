import type { PsdBakeTarget, PsdFingerprintSlot, PsdLayerReference } from "@shared/types/psdImport";
import { matchPsdFingerprintSlots, psdLayerKey, psdLayerReference, type ImportPlan, type PsdLeaf } from "@shared/utils/psdLayerPlan";
import type { CharacterAppearance } from "./CharacterAppearance";

/** The asset a baked PSD layer became, by its layer path. */
export type BakedAssetLookup = (ref: PsdLayerReference) => string | null;

/** What a slot is called, for naming the baked files and therefore the assets. */
function slotLabels(plan: ImportPlan): Map<string, { slot: string; tag?: string }> {
    const labels = new Map<string, { slot: string; tag?: string }>();
    for (const slot of plan.slots) {
        if (slot.kind === "constant") {
            labels.set(psdLayerKey(slot.leaf), { slot: slot.name });
            continue;
        }
        for (const option of slot.options) {
            labels.set(psdLayerKey(option.leaf), { slot: slot.axis, tag: option.tag });
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
        const label = labels.get(psdLayerKey(target));
        if (!label) return target;
        return { ...target, name: [prefix, label.slot, label.tag].filter(Boolean).join("_") };
    });
}

/** Every leaf that becomes art of its own, which is one bake target each. */
function artLeaves(plan: ImportPlan): PsdLeaf[] {
    return plan.slots.flatMap(slot => (slot.kind === "constant" ? [slot.leaf] : slot.options.map(o => o.leaf)));
}

/** Prepare one mapping for the preview, asset refresh and character update. */
export function preparePsdImport(appearance: CharacterAppearance, plan: ImportPlan) {
    const leaves = artLeaves(plan);
    const matches = matchPsdFingerprintSlots(appearance.getPsdFingerprint()?.slots ?? [], leaves);
    for (const [key, slot] of matches) {
        const layer = appearance.getLayer(slot.layerId);
        const axis = layer?.axisId ? appearance.getAxis(layer.axisId) : null;
        if (!layer || (slot.tagId ? !axis?.tags.some(tag => tag.id === slot.tagId) : Boolean(layer.axisId))) {
            matches.delete(key);
        }
    }
    return {
        summary: { created: leaves.length - matches.size, refreshed: matches.size },
        refreshTargets: (bakeNames: ReadonlyMap<string, string>, assetNameOf: (assetId: string) => string | null) =>
            psdRefreshTargets(appearance, leaves, matches, bakeNames, assetNameOf),
        apply: (assetIdOf: BakedAssetLookup) => applyPsdPlan(appearance, plan, matches, assetIdOf),
    };
}

/**
 * The image each layer of this import already has, by PSD layer key, for a re-import to
 * write the layer's new bytes into instead of importing a second file beside it.
 *
 * A layer qualifies when the fingerprint still recognises its slot and the slot still shows the image
 * the last import put there. Fingerprints record that image now; for a slot recorded before they did,
 * the image qualifies when it still carries the name the import gave it - the bake's file name, which
 * the library names an import after, with the `-1` it adds to a repeat and the `000-` an import once
 * put in front of it. Anything else is left out and gets a file of its own: a layer new to the sheet,
 * and a slot the author has since pointed at another image, which a re-import must never write over.
 * An image two slots share is refreshed once.
 */
function psdRefreshTargets(
    appearance: CharacterAppearance,
    leaves: PsdLeaf[],
    matches: ReadonlyMap<string, PsdFingerprintSlot>,
    bakeNames: ReadonlyMap<string, string>,
    assetNameOf: (assetId: string) => string | null,
): Map<string, string> {
    const claimed = new Set<string>();
    const targets = new Map<string, string>();
    for (const leaf of leaves) {
        const key = psdLayerKey(leaf);
        const hit = matches.get(key);
        const layer = hit ? appearance.getLayer(hit.layerId) : null;
        const current = hit?.tagId ? layer?.options?.[hit.tagId] : layer?.assetId;
        if (!current || claimed.has(current)) {
            continue;
        }
        const madeHere = hit?.assetId;
        const ours = madeHere !== undefined
            ? madeHere === current
            : isBakedName(assetNameOf(current), bakeNames.get(key));
        if (ours) {
            targets.set(key, current);
            claimed.add(current);
        }
    }
    return targets;
}

/** Whether an asset's name is the one the library gives a baked layer file, or a repeat of it. */
function isBakedName(assetName: string | null, bakeName: string | undefined): boolean {
    if (!assetName || !bakeName) {
        return false;
    }
    const escaped = bakeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^(\\d{3}-)?${escaped}(-\\d+)?(\\.png)?$`, "i").test(assetName);
}

/**
 * Build the plan into the character, and report where every PSD layer landed.
 *
 * Additive by construction: a layer the fingerprint still recognises has its image replaced, and
 * anything else is created. Nothing is deleted and nothing is renamed — a re-import must not undo
 * the author's own work on a stack they have since renamed, reordered and rebound, which is the
 * entire reason the mapping is remembered rather than the file.
 *
 * The returned slots become the new fingerprint, so the next import can do the same again. Each
 * records the image it was given, which is what lets the next import refresh that image in place.
 */
function applyPsdPlan(
    appearance: CharacterAppearance,
    plan: ImportPlan,
    matches: ReadonlyMap<string, PsdFingerprintSlot>,
    assetIdOf: BakedAssetLookup,
): PsdFingerprintSlot[] {
    const built: PsdFingerprintSlot[] = [];
    const findSlot = (leaf: PsdLeaf) => matches.get(psdLayerKey(leaf));

    for (const slot of plan.slots) {
        if (slot.kind === "constant") {
            const existing = findSlot(slot.leaf);
            const layerId = existing?.layerId ?? appearance.createLayer(slot.name)?.id;
            if (!layerId) continue;
            const assetId = assetIdOf(slot.leaf);
            appearance.setLayerAsset(layerId, assetId);
            built.push({ ...psdLayerReference(slot.leaf), layerId, ...(assetId ? { assetId } : {}) });
            continue;
        }

        // Every tag of an axis feeds the same Studio layer, so any option that still reconnects
        // identifies the layer the whole group belongs to.
        const reconnected = slot.options
            .map(option => findSlot(option.leaf))
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
            const hit = findSlot(option.leaf);
            // A tag added to the PSD since the last import is added to the axis rather than
            // ignored; `createTag` is what keeps every layer on the axis listing it too.
            const tagId = hit?.tagId ?? appearance.createTag(axisId, option.tag)?.id;
            if (!tagId) continue;
            const assetId = assetIdOf(option.leaf);
            appearance.setLayerOption(layerId, tagId, assetId);
            built.push({ ...psdLayerReference(option.leaf), layerId, tagId, ...(assetId ? { assetId } : {}) });
        }
    }

    return built;
}
