import { resolveStoredAssetSetValue } from "@shared/build/blueprintAssetSlots";
import type { AssetVariantMap } from "@shared/types/assetSet";
import { readRuntimeLocale } from "@/lib/ui-editor/runtime/localization/runtimeLocale";

/**
 * A stored value, with any asset set the build wrote an answer for replaced by the member the
 * player's language asks for.
 *
 * Guarded on `assetVariants` before anything else: the data-pin caller runs this on every pin read,
 * and an authored document has no answers at all, so the ordinary path is one property lookup. The
 * locale is read only once that lookup says there is something to resolve.
 *
 * # Why this is its own module
 *
 * Two callers need it and they must not import each other. `resolveDataPinValue` covers every pin
 * whose stored key is the pin's own id; a node that keeps its asset under an inspector param of a
 * different name - Play Sound and its `soundAssetId` - reads that param itself and has to ask the
 * same question. Putting the answer in the 3400-line resolver would have the node importing the
 * registry that registers it.
 *
 * # What it does not do
 *
 * It rewrites only ids the build itself wrote an answer for, so no caller has to know which of its
 * params carry assets - a question none of them could answer for a plugin's node anyway.
 *
 * A blueprint that has already assigned a picture or started a clip does not re-run when the
 * language changes, the same way a line of dialogue already on screen does not; the next run
 * resolves in the new language.
 */
export function resolveNodeStoredAssetSet(
    node: { assetVariants?: AssetVariantMap } | undefined,
    value: unknown,
): unknown {
    if (!node?.assetVariants) {
        return value;
    }
    const { locale, sourceLocale } = readRuntimeLocale();
    return resolveStoredAssetSetValue(node, value, locale, sourceLocale);
}
