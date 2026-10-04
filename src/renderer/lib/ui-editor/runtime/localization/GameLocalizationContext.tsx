/**
 * Game localization context for UI widget text. GameApp provides the bundle
 * payload plus a reactive current-locale source (host persistence snapshot);
 * text-bearing widget renderers resolve their display text through
 * {@link useLocalizedWidgetText}. The editor canvas mounts no provider, so
 * design-time rendering always shows the source-language text - a keyed text
 * or button's from the key registry the editor publishes (`designTimeKeys.ts`).
 * Comments in English per project convention.
 */

import { createContext, useContext, useSyncExternalStore } from "react";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { resolveAssetVariantMember, type AssetVariantCarrier } from "@shared/types/assetSet";
import { resolveUITextWords, type UITextWordsInput } from "@shared/types/ui-editor/textSource";
import {
    getDesignTimeLocalizationKeys,
    subscribeDesignTimeLocalizationKeys,
} from "./designTimeKeys";

export type GameLocalizationRuntime = {
    bundle: GameLocalizationBundle;
    /** Synchronous current-locale read (persistence snapshot; falls back to the source locale). */
    getLocale: () => string;
    /** Subscribe to locale (persistence) changes; returns an unsubscribe. */
    subscribe: (listener: () => void) => () => void;
};

export const GameLocalizationContext = createContext<GameLocalizationRuntime | null>(null);

const noopSubscribe = () => () => undefined;

export { uiTextUnitId } from "@shared/types/ui-editor/textSource";

/**
 * A widget's words as its renderer has them, and the text site they sit on (`textSites.ts`) - which
 * prop they are, whether a key replaces them, whether the canvas draws that key.
 */
export type LocalizedWidgetTextInput = UITextWordsInput;

/**
 * Resolve a widget's display text for the current locale (`resolveUITextWords`). Re-renders when the
 * player's language changes. Outside a provider (editor canvas, previews without localization) the
 * words handed in are returned - or, on a site that draws its key on the canvas, the key's
 * source-language text from the registry the editor publishes.
 */
export function useLocalizedWidgetText(input: LocalizedWidgetTextInput): string {
    const runtime = useContext(GameLocalizationContext);
    const locale = useSyncExternalStore(
        runtime?.subscribe ?? noopSubscribe,
        () => runtime?.getLocale() ?? "",
        () => "",
    );
    const designTimeKeys = useSyncExternalStore(
        !runtime && input.site.canvasDrawsKey ? subscribeDesignTimeLocalizationKeys : noopSubscribe,
        getDesignTimeLocalizationKeys,
        getDesignTimeLocalizationKeys,
    );
    return resolveUITextWords(
        input,
        runtime ? { kind: "game", bundle: runtime.bundle, locale } : { kind: "canvas", keys: designTimeKeys },
    );
}

/**
 * The asset a record's set reference resolves to for the language the game is being played in.
 *
 * The picture half of {@link useLocalizedWidgetText}, and deliberately the same shape: a widget
 * resolves at its own reference point, from the record it was already rendering, and re-renders when
 * the player changes language. That is not optional polish - a language button on the title screen
 * changes the language **without restarting**, so a picture resolved once at load would keep showing
 * the old language's art until something else happened to remount it.
 *
 * Answers the id untouched in three cases, each of which is a host that has its own answer:
 *
 *  - **The editor canvas**, which mounts no provider. `useAssetObjectUrl` resolves a set there
 *    against the live library, in the project's source language - a preview of another language is
 *    a build concern.
 *  - **Any record with no map**, which is every widget that names an ordinary file, and every widget
 *    at all until a build writes one.
 *  - **A set whose axis was collapsed at build time**, whose slot holds a member id by then and has
 *    no map to look in.
 *
 * Subscribing only while a map exists is a cost decision, not a correctness one: this runs for every
 * rectangle on the page, and a widget with no set has nothing to re-render for.
 */
export function useLocalizedAssetId(
    carrier: AssetVariantCarrier | null | undefined,
    assetId: string | null | undefined,
): string | null | undefined {
    const runtime = useContext(GameLocalizationContext);
    const hasVariants = Boolean(assetId && carrier?.assetVariants?.[assetId]);
    const locale = useSyncExternalStore(
        hasVariants ? (runtime?.subscribe ?? noopSubscribe) : noopSubscribe,
        () => (hasVariants ? runtime?.getLocale() ?? "" : ""),
        () => "",
    );
    if (!assetId || !hasVariants) {
        return assetId;
    }
    return resolveAssetVariantMember(
        carrier?.assetVariants,
        assetId,
        locale,
        runtime?.bundle.sourceLocale,
    ) ?? assetId;
}
