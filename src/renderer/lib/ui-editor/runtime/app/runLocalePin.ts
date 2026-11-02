import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { isKeysOnlyLocalization, LOCALE_STORAGE_KEY, type GameLocalizationBundle } from "@shared/types/localization";

/**
 * The language a Dev Mode run was asked to be shown in, from the workspace's run menu.
 *
 * It takes the place of the player's stored language and of the system-language match, and it is
 * held **session-only**: written into this session's copy of the persistence scope, never into the
 * store. That is the whole of "does not touch the player's data" - the next run without a choice
 * reads exactly what it would have read before, and every reader of the game's language (text,
 * names, fonts, the `Get Language` node) answers the pinned one because they all read that key.
 *
 * The same mechanism the system-language match uses, and for the same reason: the value is
 * re-derived on every boot from something outside the store - here, the run menu.
 *
 * # When the game changes its own language
 *
 * A game's language switch is a feature the author may be testing in this very run. It writes the
 * player's choice and restarts, and a Dev Mode restart is a session reload whose bundle carries the
 * same pin. Re-applied, the pin would undo the switch the author just pressed, which looks like the
 * switch is broken. So the game yields: once it has switched language in this window, the pin it
 * switched away from is no longer applied, until the run menu names a different language or the run
 * is started again.
 */
export type RunLocalePinScope = Pick<ScopeStoreBridge, "persistenceSetSessionOnly">;

/** The code to pin, or null when nothing should be pinned. */
export function pinnedRunLocale(
    runLocale: string | undefined,
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined,
    yieldedTo: string | null,
): string | null {
    if (!runLocale || !localization || isKeysOnlyLocalization(localization)) {
        return null;
    }
    if (runLocale === yieldedTo) {
        return null;
    }
    return localization.locales.some(locale => locale.code === runLocale) ? runLocale : null;
}

/** Pin the run's language into `scope` for this session. Answers whether it did. */
export function applyRunLocalePin(
    scope: RunLocalePinScope,
    runLocale: string | undefined,
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined,
    yieldedTo: string | null,
): boolean {
    const code = pinnedRunLocale(runLocale, localization, yieldedTo);
    if (!code) {
        return false;
    }
    // Session-only on purpose: see the module comment. A durable write here would be the run menu
    // deciding the player's language for every later run.
    scope.persistenceSetSessionOnly(LOCALE_STORAGE_KEY, code);
    return true;
}

/**
 * Which pin the game has stepped away from, kept across the cores one window builds.
 *
 * Forgotten as soon as a bundle names a different pin (or none): choosing a language in the run
 * menu is a new request, including choosing again the one the game switched away from earlier.
 */
export class RunLocaleYield {
    private seen: string | undefined;
    private yielded: string | null = null;

    /** Called with every bundle's pin, before it is applied. */
    public noteBundle(runLocale: string | undefined): void {
        if (runLocale !== this.seen) {
            this.seen = runLocale;
            this.yielded = null;
        }
    }

    /** Called when the game sets its own language while `runLocale` is pinned. */
    public noteGameSwitch(runLocale: string | undefined): void {
        if (runLocale) {
            this.yielded = runLocale;
        }
    }

    public yieldedTo(): string | null {
        return this.yielded;
    }
}
