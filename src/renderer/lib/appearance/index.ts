import { normalizeAccentColor } from "@shared/constants/accent";
import { observeGlobalSettings } from "@/lib/settings/observeGlobalSettings";
import { TOOLTIP_DELAY_KEY } from "@/lib/settings/tooltipOptions";
import { UI_FONT_FAMILY_KEY, UI_FONT_VAR, uiFontCssFamily } from "@/lib/settings/uiFontOptions";
import { setTooltipDelay } from "@/lib/tooltip";

/**
 * Apply the appearance preferences CSS cannot resolve on its own: `ui.accentColor`,
 * `ui.fontFamily`, `ui.reduceMotion` and `ui.tooltipDelay`.
 *
 * Unlike the theme — which is pure CSS, because Electron's nativeTheme drives
 * `prefers-color-scheme` in every renderer — none of these has a media query
 * the main process can point at, so they all follow the same pattern as the zoom
 * and the locale: read the stored value before the first paint, then follow the
 * main process's global-state broadcast.
 *
 * They all land on the root element, and are therefore Studio-only in practice:
 * this module is part of the Studio renderer bootstrap (lib/renderApp), which a
 * shipped game never runs. A game keeps the brand accent and its author's motion
 * whatever the person who built it prefers locally.
 */

let observer: ReturnType<typeof observeGlobalSettings> | null = null;

/** Listeners for the motion preference, for the React side (see `MotionConfig` in renderApp). */
const motionListeners = new Set<(reduced: boolean) => void>();
let reduceMotion = false;

function applyAccentColor(value: unknown): void {
    const accent = normalizeAccentColor(value);
    const root = document.documentElement.style;
    root.setProperty("--nl-primary", accent.channels);
    // The ink that sits on the accent. Derived rather than fixed white: the user can pick any
    // color, and a pale one would otherwise make every primary button unreadable.
    root.setProperty("--nl-on-primary", accent.foregroundChannels);
    // The accent written on a surface rather than under one — `text-primary`, `border-primary`.
    // Both ladders are published because nothing here can ask which theme is current: that is a
    // media query, and Electron changes its value without dispatching `change`. The stylesheet
    // picks between them, so a theme switch needs nothing from this module.
    root.setProperty("--nl-primary-ink-on-dark", accent.inkOnDarkChannels);
    root.setProperty("--nl-primary-ink-on-light", accent.inkOnLightChannels);
}

/**
 * Publish `ui.fontFamily` as the custom property the interface is set from.
 *
 * A variable rather than a `font-family` written straight onto the root element, because the one
 * rule that reads it is guarded (`html.nl-studio` in styles.css). This bootstrap runs in the Dev
 * Mode window too — which hosts the game in-document — and an inline declaration there would set
 * the author's game in the author's editor font. Publishing a value nothing in that document reads
 * costs nothing and keeps the "Studio chrome only" decision in the one place that already makes it.
 */
function applyUIFontFamily(value: unknown): void {
    document.documentElement.style.setProperty(UI_FONT_VAR, uiFontCssFamily(value));
}

/**
 * Hand the tooltip delay to the controller, which is where the timer runs.
 *
 * A number rather than a class or a custom property, because the value is read in JS when a pointer
 * settles on a control - there is no rule CSS could apply on its own.
 */
function applyTooltipDelay(value: unknown): void {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
        setTooltipDelay(numeric);
    }
}

function applyReduceMotion(value: unknown): void {
    reduceMotion = value === true;
    document.documentElement.classList.toggle("nl-reduce-motion", reduceMotion);
    for (const listener of motionListeners) {
        listener(reduceMotion);
    }
}

/**
 * Whether motion is currently reduced *by the setting*.
 *
 * Deliberately not the OS preference: CSS already answers that through
 * `prefers-reduced-motion`, and mirroring a media query in JS is how the theme
 * layer broke once before (Electron updates a query's value without dispatching
 * `change`). The framer-motion side reads the OS preference itself.
 */
export function isReduceMotionEnabled(): boolean {
    return reduceMotion;
}

/**
 * Paint an accent onto THIS window only, without storing it.
 *
 * What the Settings window's color picker calls while the user drags: the map emits on every
 * pointer move, and persisting each one would write to disk and broadcast to every open window
 * at frame rate. The commit on release goes through the normal path and the broadcast puts every
 * window — including this one — back in agreement.
 */
export function previewAccentColor(value: unknown): void {
    applyAccentColor(value);
}

export function subscribeReduceMotion(listener: (reduced: boolean) => void): () => void {
    motionListeners.add(listener);
    return () => {
        motionListeners.delete(listener);
    };
}

export async function initAppearance(): Promise<void> {
    observer ??= observeGlobalSettings(
        ["ui.accentColor", UI_FONT_FAMILY_KEY, "ui.reduceMotion", TOOLTIP_DELAY_KEY],
        (key, value) => {
            if (key === "ui.accentColor") {
                applyAccentColor(value);
            } else if (key === UI_FONT_FAMILY_KEY) {
                applyUIFontFamily(value);
            } else if (key === "ui.reduceMotion") {
                applyReduceMotion(value);
            } else if (key === TOOLTIP_DELAY_KEY) {
                applyTooltipDelay(value);
            }
        },
        (_key, error) => console.warn("[appearance] Failed to load an appearance preference.", error),
    );
    await observer.ready;
}
