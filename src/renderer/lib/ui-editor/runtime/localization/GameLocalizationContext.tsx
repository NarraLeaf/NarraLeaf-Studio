/**
 * Game localization context for UI widget text. GameApp provides the bundle
 * payload plus a reactive current-locale source (host persistence snapshot);
 * text-bearing widget renderers resolve their display text through
 * {@link useLocalizedWidgetText}. The editor canvas mounts no provider, so
 * design-time rendering always shows the source-language text.
 * Comments in English per project convention.
 */

import { createContext, useContext, useSyncExternalStore } from "react";
import {
    localizationKeyUnitId,
    resolveLocalizedUnitText,
    type GameLocalizationBundle,
} from "@shared/types/localization";

export type GameLocalizationRuntime = {
    bundle: GameLocalizationBundle;
    /** Synchronous current-locale read (persistence snapshot; falls back to the source locale). */
    getLocale: () => string;
    /** Subscribe to locale (persistence) changes; returns an unsubscribe. */
    subscribe: (listener: () => void) => () => void;
};

export const GameLocalizationContext = createContext<GameLocalizationRuntime | null>(null);

const noopSubscribe = () => () => undefined;

/** Stable translation-unit id for a widget's localizable text prop. */
export function uiTextUnitId(elementId: string, prop: string): string {
    return `ui:${elementId}.${prop}`;
}

export type LocalizedWidgetTextInput = {
    elementId: string;
    /** Which prop carries the text ("text" for text widgets, "label" for buttons). */
    prop: "text" | "label";
    /** Authored source-language text (always what design time renders). */
    sourceText: string;
    /** Implicit unit opt-in (`ui:<elementId>.<prop>`). */
    localizable?: boolean;
    /** Named-key reference; takes precedence over the implicit unit. */
    localizationKey?: string;
};

/**
 * Resolve a widget's display text for the current locale. Re-renders when the
 * player's language changes. Outside a provider (editor canvas, previews
 * without localization) the source text is returned untouched.
 */
export function useLocalizedWidgetText(input: LocalizedWidgetTextInput): string {
    const runtime = useContext(GameLocalizationContext);
    const locale = useSyncExternalStore(
        runtime?.subscribe ?? noopSubscribe,
        () => runtime?.getLocale() ?? "",
        () => "",
    );
    if (!runtime) {
        return input.sourceText;
    }
    const keyName = input.localizationKey?.trim();
    if (keyName) {
        return resolveLocalizedUnitText(runtime.bundle, locale, localizationKeyUnitId(keyName))
            ?? runtime.bundle.keys?.[keyName]
            ?? input.sourceText;
    }
    if (!input.localizable) {
        return input.sourceText;
    }
    return resolveLocalizedUnitText(runtime.bundle, locale, uiTextUnitId(input.elementId, input.prop))
        ?? input.sourceText;
}
