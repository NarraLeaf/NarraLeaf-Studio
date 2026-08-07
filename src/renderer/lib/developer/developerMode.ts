import { useSyncExternalStore } from "react";
import { getInterface } from "@/lib/app/bridge";

/**
 * Developer options (`app.developerMode`), read as a per-window store.
 *
 * Follows the same shape as the accent color and the locale (`lib/appearance`, `lib/i18n/bootstrap`):
 * the value is loaded once before the first paint and then followed through the main process's
 * global-state broadcast, so switching it in the Settings window - a different window - reaches every
 * open workspace without a restart.
 *
 * A store rather than a hook per reader because the first reader cannot use a hook: context menus are
 * assembled inside event handlers (`buildCanvasContextMenu` and friends), where the only thing
 * available is a synchronous read. {@link useDeveloperMode} exists for the React side.
 *
 * The name is deliberately not "dev mode": Dev Mode already means running the game in a Studio window
 * with the debug panels (`ui.runMode`), and the two have nothing to do with each other.
 */

/** Global-state key the preference is stored under. */
export const DEVELOPER_MODE_KEY = "app.developerMode" as const;

/**
 * Off.
 *
 * The rows this adds name things an author never types: an element's identifier is generated, and
 * every place one is needed - a blueprint binding, a lint result - resolves it through a picker. So
 * the audience is somebody debugging Studio or writing a plugin, and for everybody else it is a
 * second copy row under every right-click.
 */
export const DEVELOPER_MODE_DEFAULT = false;

let enabled: boolean = DEVELOPER_MODE_DEFAULT;
let subscribed = false;
const listeners = new Set<() => void>();

function apply(value: unknown): void {
    // An unset key broadcasts `undefined`, which resolves to the default like every other reader.
    const next = value === true;
    if (next === enabled) {
        return;
    }
    enabled = next;
    for (const listener of listeners) {
        listener();
    }
}

/** Whether developer options are on right now. Safe to call from an event handler. */
export function isDeveloperModeEnabled(): boolean {
    return enabled;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The same value for components, re-rendering when it is switched in the Settings window. */
export function useDeveloperMode(): boolean {
    return useSyncExternalStore(subscribe, isDeveloperModeEnabled, () => DEVELOPER_MODE_DEFAULT);
}

/**
 * Load the persisted value and follow it. Call once per window, from `renderApp`.
 *
 * Failing to read leaves the default in place: an unreadable preference must not be a window that
 * refuses to start, and the broadcast subscription below still corrects it the moment it changes.
 */
export async function initDeveloperMode(): Promise<void> {
    const state = getInterface().app.state;

    try {
        const result = await state.getGlobalState(DEVELOPER_MODE_KEY);
        if (result.success) {
            apply(result.data.value);
        }
    } catch (error) {
        console.warn("[developer] Failed to load developer options; leaving them off.", error);
    }

    if (!subscribed) {
        subscribed = true;
        state.onGlobalStateChanged?.((change) => {
            if (change.key === DEVELOPER_MODE_KEY) {
                apply(change.value);
            }
        });
    }
}

/**
 * Set the value directly, for tests and for the settings row's own optimistic update.
 *
 * Not a writer: persisting goes through the settings layer like every other preference, and this only
 * moves what this window believes.
 */
export function setDeveloperModeForTesting(value: boolean): void {
    apply(value);
}
