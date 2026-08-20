import type { BlueprintAssetPin, BlueprintAssetPinResolver } from "@/lib/workspace/services/references/referenceModel";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";

/**
 * The asset-bearing pins a node type declares, read off the project's node catalogue.
 *
 * Shared by every clipboard that carries graphs, so a widget's blueprint and a bare graph fragment
 * are swept exactly as the reference index sweeps them - one answer to "which pins hold a file",
 * whichever gesture is asking.
 *
 * Null and "declares none" are different answers, and `referenceModel` acts on the difference: a
 * node left behind by a plugin this project does not have could be holding anything, and treating
 * it as holding nothing is how a file becomes invisible while coverage reads as complete.
 */
export function createCatalogAssetPinResolver(
    catalog: BlueprintNodeCatalogService | null,
): BlueprintAssetPinResolver {
    return (nodeType: string): readonly BlueprintAssetPin[] | null => {
        if (!catalog) {
            return null;
        }
        try {
            if (!catalog.get(nodeType)) {
                return null;
            }
            return catalog.resolveCatalogEntry(nodeType).pins.flatMap(pin => (pin.assetRef
                ? [{
                    pinId: pin.id,
                    kind: pin.assetRef.kind,
                    paramKey: pin.assetRef.paramKey ?? pin.id,
                    input: pin.kind === "input",
                    origin: pin.assetRef.origin,
                }]
                : []));
        } catch {
            return null;
        }
    };
}
