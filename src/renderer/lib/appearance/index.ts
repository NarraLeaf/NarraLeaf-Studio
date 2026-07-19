import { getInterface } from "@/lib/app/bridge";
import { normalizeAccentColor } from "@shared/constants/accent";

/**
 * Apply the two appearance preferences CSS cannot resolve on its own:
 * `ui.accentColor` and `ui.reduceMotion`.
 *
 * Unlike the theme — which is pure CSS, because Electron's nativeTheme drives
 * `prefers-color-scheme` in every renderer — neither of these has a media query
 * the main process can point at, so both follow the same pattern as the zoom
 * and the locale: read the stored value before the first paint, then follow the
 * main process's global-state broadcast.
 *
 * Both land on the root element, and both are therefore Studio-only in practice:
 * this module is part of the Studio renderer bootstrap (lib/renderApp), which a
 * shipped game never runs. A game keeps the brand accent and its author's motion
 * whatever the person who built it prefers locally.
 */

let subscribed = false;

/** Listeners for the motion preference, for the React side (see `MotionConfig` in renderApp). */
const motionListeners = new Set<(reduced: boolean) => void>();
let reduceMotion = false;

function applyAccentColor(value: unknown): void {
    const accent = normalizeAccentColor(value);
    document.documentElement.style.setProperty("--nl-primary", accent.channels);
    // The ink that sits on the accent. Derived rather than fixed white: the user can pick any
    // color, and a pale one would otherwise make every primary button unreadable.
    document.documentElement.style.setProperty("--nl-on-primary", accent.foregroundChannels);
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
    const state = getInterface().app.state;

    try {
        const [accent, motion] = await Promise.all([
            state.getGlobalState("ui.accentColor"),
            state.getGlobalState("ui.reduceMotion"),
        ]);
        if (accent.success) {
            applyAccentColor(accent.data.value);
        }
        if (motion.success) {
            applyReduceMotion(motion.data.value);
        }
    } catch (error) {
        console.warn("[appearance] Failed to load appearance preferences; using defaults.", error);
    }

    if (!subscribed) {
        subscribed = true;
        state.onGlobalStateChanged?.((change) => {
            if (change.key === "ui.accentColor") {
                applyAccentColor(change.value);
            } else if (change.key === "ui.reduceMotion") {
                applyReduceMotion(change.value);
            }
        });
    }
}
