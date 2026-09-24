import type { TranslationKey } from "@shared/i18n/catalog";
import {
    blueprintLabelKey,
    blueprintNodeTitleKey,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import type { AssetNameGap, AssetNameOrigin } from "./assetNameGaps";
import type { ReferenceIndexGap } from "./referenceModel";

/**
 * The one sentence an asset-name gap is reported in, wherever it is reported.
 *
 * The canvas, `blueprint check`, the project check, the build and the delete dialog all render a
 * gap through here, so an author reads the same words about the same place on every surface - and
 * in each of them a node is named the way its card on the canvas names it, not by the English the
 * catalogue declares it in.
 *
 * The sentence lives in the project check's catalogue (`lint.rule.blueprintAssembledAssetName`),
 * because that is the one reader that cannot render it where it runs: a rule may not build prose,
 * so it hands on the key and the params, and every other surface renders the same key.
 *
 * Two sentences, not one. A name the project puts together is the author's own construct and the
 * remedy is theirs; a name coming out of a node type nothing here can load is a plugin that is not
 * installed or is switched off, and telling them to pick an asset in the picker sends them to a
 * node drawn as a stub. Which one it is comes off the origin (`unknownType`).
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

/**
 * The inspector's own label for each bindable property that draws an asset, so the sentence names
 * the field the author will look for.
 */
const BINDING_PROP_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
    "imageFill.assetId": "widgets.rectangleInspector.imageFill",
};

/** Where a name was put together, as the author knows the place: a node's title, or a name they gave. */
function originText(origin: AssetNameOrigin): string {
    switch (origin.kind) {
        case "node":
            return origin.nodeTitle;
        case "storyRow":
            return `${origin.storyName} › ${origin.sceneName}`;
        case "listSource":
            return origin.elementName;
        case "script":
            return origin.blueprintName;
    }
}

export function assetNameGapMessage(gap: AssetNameGap): AssetNameGapMessage {
    const params: Record<string, string> = { origin: originText(gap.origin) };
    const paramKeys: Record<string, TranslationKey> = {};
    const setKey = (name: string, key: TranslationKey | undefined) => {
        if (key) {
            paramKeys[name] = key;
        }
    };
    if (gap.origin.kind === "node") {
        setKey("origin", blueprintNodeTitleKey(gap.origin.nodeTitle));
    }
    // A node type nothing here can load is named by its type - there is no card to take a title
    // from, and the type is what says which plugin is missing, the way `blueprint/unknown-node`
    // names it. The sentence differs too: the author has a plugin to install or switch on, not a
    // name of their own to change.
    const unloaded = gap.origin.kind === "node" && gap.origin.unknownType === true;
    if (unloaded && gap.origin.kind === "node") {
        delete paramKeys.origin;
        params.origin = gap.origin.nodeType;
    }
    const sink = gap.sink;
    if (sink.kind === "pin") {
        params.node = sink.nodeTitle;
        params.pin = sink.pinLabel;
        setKey("node", blueprintNodeTitleKey(sink.nodeTitle));
        setKey("pin", blueprintLabelKey(sink.pinLabel));
        return {
            key: unloaded
                ? "lint.rule.blueprintAssembledAssetName.messageUnloadedNode"
                : "lint.rule.blueprintAssembledAssetName.message",
            params,
            paramKeys,
        };
    }
    params.element = sink.elementName;
    params.prop = sink.propPath;
    setKey("prop", BINDING_PROP_LABEL_KEYS[sink.propPath]);
    return {
        key: unloaded
            ? "lint.rule.blueprintAssembledAssetName.messageUnloadedNodeBinding"
            : "lint.rule.blueprintAssembledAssetName.messageBinding",
        params,
        paramKeys,
    };
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
 * Just the place, for a list of places: `Blueprint › Node › Pin` or `Page › Widget › Property`, named
 * the way the canvas and the inspector name them. What the delete dialog and the references panel
 * print, where the sentence around it already says what is wrong there.
 */
export function describeAssetNameGapSite(gap: AssetNameGap, t: Translate): string {
    const sink = gap.sink;
    if (sink.kind === "pin") {
        return [
            sink.blueprintName,
            resolveBlueprintNodeTitle(sink.nodeTitle, t),
            resolveBlueprintLabel(sink.pinLabel, t),
        ].join(" › ");
    }
    const propKey = BINDING_PROP_LABEL_KEYS[sink.propPath];
    return [
        sink.surfaceName ?? sink.componentName,
        sink.elementName,
        propKey ? t(propKey) : sink.propPath,
    ].filter((part): part is string => Boolean(part)).join(" › ");
}

/**
 * The places a reference check stopped at, as the delete dialog lists them.
 *
 * Grouped by what went wrong there, because the two call for different things: a place that picks
 * its asset by a name assembled at run time is something the author wrote and can change, and a
 * document that would not read is something to retry. At most `limit` places per group, then a count
 * of the rest.
 */
export function describeReferenceGapSites(
    gaps: readonly ReferenceIndexGap[],
    t: Translate,
    limit: number,
): string {
    const assembled = gaps.filter(gap => gap.assetName);
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
    block("assets.delete.unverifiedComputed", assembled.map(gap => describeAssetNameGapSite(gap.assetName!, t)));
    block("assets.delete.unverifiedUnreadable", unreadable.map(gap => gap.location!));
    return blocks.join("\n\n");
}
