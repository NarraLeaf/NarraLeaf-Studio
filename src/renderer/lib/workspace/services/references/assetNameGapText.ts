import type { TranslationKey } from "@shared/i18n/catalog";
import {
    blueprintLabelKey,
    blueprintNodeTitleKey,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import type { AssetNameGap } from "./assetNameGaps";
import type { ReferenceIndexGap } from "./referenceModel";

/**
 * The one sentence an asset-name gap is reported in, wherever it is reported.
 *
 * The canvas, `blueprint check`, the project check, the build and the delete dialog all render a
 * gap through here, so an author reads the same words about the same node on every surface - and
 * in each of them the node is named the way its card on the canvas names it, not by the English
 * the catalogue declares it in.
 *
 * The sentence lives in the project check's catalogue (`lint.rule.blueprintComputedAssetName`),
 * because that is the one reader that cannot render it where it runs: a rule may not build prose,
 * so it hands on the key and the params, and every other surface renders the same key.
 */

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A message as a rule hands it on: the key, the params, and which params are keys themselves. */
export interface AssetNameGapMessage {
    key: TranslationKey;
    /** Every param in plain text - English for a title with no catalogue entry. */
    params: Record<string, string>;
    /** Params the reader renders from the catalogue, in its own language. */
    paramKeys: Record<string, TranslationKey>;
}

/** The label the image inspector gives the field a list row's picture is bound to. */
const IMAGE_FILL_LABEL_KEY: TranslationKey = "widgets.rectangleInspector.imageFill";

export function assetNameGapMessage(gap: AssetNameGap): AssetNameGapMessage {
    const params: Record<string, string> = {
        node: gap.sink.nodeTitle,
        pin: gap.sink.pinLabel,
        origin: gap.origin.nodeTitle,
        imageFill: "Image Fill",
    };
    const paramKeys: Record<string, TranslationKey> = { imageFill: IMAGE_FILL_LABEL_KEY };
    const nodeKey = blueprintNodeTitleKey(gap.sink.nodeTitle);
    const pinKey = blueprintLabelKey(gap.sink.pinLabel);
    const originKey = blueprintNodeTitleKey(gap.origin.nodeTitle);
    if (nodeKey) {
        paramKeys.node = nodeKey;
    }
    if (pinKey) {
        paramKeys.pin = pinKey;
    }
    if (originKey) {
        paramKeys.origin = originKey;
    }
    return { key: "lint.rule.blueprintComputedAssetName.message", params, paramKeys };
}

/** The whole sentence, in the language `t` speaks. */
export function describeAssetNameGap(gap: AssetNameGap, t: Translate): string {
    const message = assetNameGapMessage(gap);
    const params: Record<string, string> = { ...message.params };
    for (const [name, key] of Object.entries(message.paramKeys)) {
        params[name] = t(key);
    }
    return t(message.key, params);
}

/**
 * Just the place, for a list of places: `Blueprint › Node › Pin`, with the node and the pin named
 * the way the canvas names them. What the delete dialog and the references panel print, where the
 * sentence around it already says what is wrong there.
 */
export function describeAssetNameGapSite(gap: AssetNameGap, t: Translate): string {
    const sink = gap.sink;
    return [
        sink.blueprintName,
        resolveBlueprintNodeTitle(sink.nodeTitle, t),
        resolveBlueprintLabel(sink.pinLabel, t),
    ].join(" › ");
}

/**
 * The places a reference check stopped at, as the delete dialog lists them.
 *
 * Grouped by what went wrong there, because the two call for different things: a node that picks
 * its asset by a computed value is something the author wrote and can change, and a document that
 * would not read is something to retry. At most `limit` places per group, then a count of the rest.
 */
export function describeReferenceGapSites(
    gaps: readonly ReferenceIndexGap[],
    t: Translate,
    limit: number,
): string {
    const computed = gaps.filter(gap => gap.assetName);
    const unreadable = gaps.filter(gap => !gap.assetName && gap.location);
    const blocks: string[] = [];
    const block = (headingKey: TranslationKey, places: string[]) => {
        if (places.length === 0) {
            return;
        }
        const unique = [...new Set(places)];
        const shown = unique.slice(0, limit).map(place => `- ${place}`);
        if (unique.length > limit) {
            shown.push(`  ${t("assets.delete.moreReferences", { count: unique.length - limit })}`);
        }
        blocks.push([t(headingKey), ...shown].join("\n"));
    };
    block("assets.delete.unverifiedComputed", computed.map(gap => describeAssetNameGapSite(gap.assetName!, t)));
    block("assets.delete.unverifiedUnreadable", unreadable.map(gap => gap.location!));
    return blocks.join("\n\n");
}
