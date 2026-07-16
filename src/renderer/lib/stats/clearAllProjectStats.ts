import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { PROJECT_STATS_SETTINGS_KEY_PREFIX, createEmptyProjectStats } from "@shared/types/stats";

/**
 * Reset the accumulated activity statistics of every project this Studio has recorded.
 *
 * Runs from the Settings window, which has no workspace context and therefore no notion of a
 * "current project" — hence the all-projects scope. The per-project equivalent lives on the
 * dashboard, where the project is known.
 *
 * Keys are overwritten with an empty record rather than deleted: global state exposes no delete
 * channel, and an empty record is what a never-recorded project reads as anyway. Any workspace
 * window currently open on one of these projects picks the reset up through the global-state
 * broadcast, so its in-memory counters cannot resurrect what was just cleared.
 */
export async function clearAllProjectStats(): Promise<void> {
    const state = getInterface().app.state;

    const all = await state.getAllGlobalState();
    if (!all.success) {
        throw new Error(all.error ?? translate("settings.persistFailed"));
    }

    const keys = Object.keys(all.data.settings).filter(key =>
        key.startsWith(`${PROJECT_STATS_SETTINGS_KEY_PREFIX}.`),
    );

    for (const key of keys) {
        const response = await state.setGlobalState(key, createEmptyProjectStats());
        if (!response.success) {
            throw new Error(response.error ?? translate("settings.persistFailed"));
        }
    }
}
