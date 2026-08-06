import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { preferenceKeys, workspaceLayoutKeys } from "@/lib/settings/settingsScope";

/**
 * Putting settings back to their defaults.
 *
 * Deletes rather than writes: several keys are deliberately absent from GLOBAL_STATE_DEFAULTS so
 * their reader can compute a fallback the store cannot know (`editor.slashAtAlias` answers per
 * device locale, `ui.background*` clamps and whitelists a persisted value). Writing "the default"
 * over those would pin a value where the product wanted a question - which is exactly the bug
 * `clearAllProjectStats` had to live with while there was no delete channel.
 */

async function deleteKeys(keys: string[]): Promise<number> {
    if (keys.length === 0) {
        return 0;
    }
    const result = await getInterface().app.state.deleteGlobalState(keys);
    if (!result.success) {
        throw new Error(result.error ?? translate("settings.persistFailed"));
    }
    return result.data.deleted.length;
}

/** One setting back to its default. */
export async function resetSetting(key: string): Promise<void> {
    await deleteKeys([key]);
}

/** Every preference this build has. The project history and per-project data are not touched. */
export async function resetAllPreferences(): Promise<void> {
    await deleteKeys(preferenceKeys());
}

/**
 * The workspace's shape: dock visibility and widths, panel order, which tabs were open per
 * project, the UI editor's viewport.
 *
 * Its own action rather than part of the preferences reset, because "my panels went weird" and
 * "put my preferences back" are different requests, and answering one with the other is how a
 * reset button becomes something people are afraid of. The keys are read out of the store because
 * the per-project ones exist nowhere else.
 */
export async function resetWorkspaceLayout(): Promise<void> {
    const all = await getInterface().app.state.getAllGlobalState();
    if (!all.success) {
        throw new Error(all.error ?? translate("settings.persistFailed"));
    }
    await deleteKeys(workspaceLayoutKeys(all.data.settings));
}
