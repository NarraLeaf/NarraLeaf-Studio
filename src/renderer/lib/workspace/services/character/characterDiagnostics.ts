import type { CharacterAppearance } from "./CharacterAppearance";

export type LayerSize = { width: number; height: number };

export type CharacterDiagnostic = {
    /** Which message to render. The editor owns the wording; this module owns the finding. */
    code: "offCanvas" | "constantNoImage" | "layerNoImage" | "axisNoTags" | "axisUnused" | "duplicateTag" | "occluded";
    severity: "error" | "warning";
    /** What to select when the author clicks the row. */
    target: { kind: "layer" | "axis"; id: string };
    values: Record<string, string>;
};

function format(size: LayerSize): string {
    return `${size.width}×${size.height}`;
}

/**
 * Everything wrong with a layered appearance, in one pass.
 *
 * Kept out of the editor because two of these are load-bearing rather than cosmetic. A layer whose
 * axis has no tags, and a constant layer with no image, are both *silently dropped* by
 * `toLayeredDefinition` — the stack compiles and simply misses a layer. Saying so here is the only
 * place an author finds out.
 *
 * `sizes` comes from the decoded bitmaps the preview already measured (asset metadata does not carry
 * pixel size), keyed by layer id; a layer that has not been measured yet is skipped rather than
 * guessed at.
 *
 * `occluded` is passed in rather than computed: deciding that a layer is completely covered needs the
 * alpha of every layer intersected, which is the compositor's offscreen pass. Computing it here too
 * would mean two answers to one question.
 */
export function collectCharacterDiagnostics(
    appearance: CharacterAppearance,
    sizes: Record<string, LayerSize> = {},
    occluded: Record<string, boolean> = {},
): CharacterDiagnostic[] {
    if (appearance.getKind() !== "layered") {
        return [];
    }
    const found: CharacterDiagnostic[] = [];
    const axes = appearance.getAxes();
    const layers = appearance.getLayers();
    // With no declared canvas the *largest* measured layer stands in as the reference. A stack either
    // agrees with itself or it does not, and saying so needs no author input - but the guess has to
    // survive a reorder, which "the bottom layer" does not: dragging an accessory under the body
    // would otherwise flip every finding. The canvas is the document size, so the biggest layer
    // present is the closest thing to it until the author declares one.
    const canvas = appearance.getCanvas() ?? layers
        .map(layer => sizes[layer.id])
        .filter(Boolean)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;

    for (const layer of layers) {
        const size = sizes[layer.id];
        if (canvas && size && (size.width !== canvas.width || size.height !== canvas.height)) {
            found.push({
                code: "offCanvas",
                severity: "error",
                target: { kind: "layer", id: layer.id },
                values: { name: layer.name, size: format(size), canvas: format(canvas) },
            });
        }

        if (occluded[layer.id]) {
            found.push({
                code: "occluded",
                severity: "warning",
                target: { kind: "layer", id: layer.id },
                values: { name: layer.name },
            });
        }

        if (!layer.axisId) {
            if (!layer.assetId) {
                found.push({
                    code: "constantNoImage",
                    severity: "error",
                    target: { kind: "layer", id: layer.id },
                    values: { name: layer.name },
                });
            }
            continue;
        }

        // A bound layer that draws nothing under *some* tags is the scoped-layer idiom the whole
        // model rests on ("only the casual outfit has a jacket"), so only an entirely empty layer is
        // a mistake. This is why the check is on every option rather than on any of them.
        const options = Object.values(layer.options ?? {});
        if (options.length > 0 && options.every(assetId => !assetId)) {
            found.push({
                code: "layerNoImage",
                severity: "error",
                target: { kind: "layer", id: layer.id },
                values: { name: layer.name },
            });
        }
    }

    for (const axis of axes) {
        if (axis.tags.length === 0) {
            found.push({
                code: "axisNoTags",
                severity: "error",
                target: { kind: "axis", id: axis.id },
                values: { name: axis.name },
            });
        } else if (!layers.some(layer => layer.axisId === axis.id)) {
            found.push({
                code: "axisUnused",
                severity: "error",
                target: { kind: "axis", id: axis.id },
                values: { name: axis.name },
            });
        }

        const seen = new Set<string>();
        for (const tag of axis.tags) {
            const key = tag.name.trim().toLowerCase();
            if (seen.has(key)) {
                found.push({
                    code: "duplicateTag",
                    severity: "warning",
                    target: { kind: "axis", id: axis.id },
                    values: { axis: axis.name, name: tag.name },
                });
            }
            seen.add(key);
        }
    }

    return found;
}
