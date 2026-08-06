import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import {
    MACHINE_SPECIFIC_PREFERENCE_KEYS,
    PERSONAL_PREFERENCE_KEYS,
    preferenceKeys,
    settingsValueSpecs,
} from "@/lib/settings/settingsScope";
import {
    composeSettingsDocument,
    parseSettingsDocument,
    planSettingsImport,
    serializeSettingsDocument,
    type SettingsImportPlan,
} from "@shared/utils/settingsDocument";
import type { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";

/** What an export carries beyond the plain preferences. Both default off; see settingsScopes. */
export type SettingsExportOptions = {
    /** The workspace wallpaper and how it is displayed. Names a file the other machine lacks. */
    includeWallpaper: boolean;
    /** The name and address recorded on commits. Wanted on your own second machine, not on a colleague's. */
    includeIdentity: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: SettingsExportOptions = {
    includeWallpaper: false,
    includeIdentity: false,
};

function exportableKeys(options: SettingsExportOptions): string[] {
    const excluded = new Set<string>([
        ...(options.includeWallpaper ? [] : MACHINE_SPECIFIC_PREFERENCE_KEYS),
        ...(options.includeIdentity ? [] : PERSONAL_PREFERENCE_KEYS),
    ]);
    return preferenceKeys().filter(key => !excluded.has(key));
}

/**
 * Write the author's preferences to a file they pick.
 *
 * Only keys that are actually stored are written out: a document listing every default would be
 * three times the size and would, on import, present thirty rows of "no change" for the author to
 * read past.
 */
export async function exportSettings(options: SettingsExportOptions): Promise<{ canceled: boolean; filePath?: string }> {
    const [all, info] = await Promise.all([
        getInterface().app.state.getAllGlobalState(),
        getInterface().getAppInfo(),
    ]);
    if (!all.success) {
        throw new Error(all.error ?? translate("settings.persistFailed"));
    }
    const stored = all.data.settings;
    const settings: Record<string, unknown> = {};
    for (const key of exportableKeys(options)) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
            settings[key] = stored[key];
        }
    }

    const platform = await getInterface().getPlatform();
    const document = composeSettingsDocument({
        settings,
        studioVersion: info.success ? info.data.version : "",
        platform: platform.success ? platform.data.system : "",
        exportedAt: new Date().toISOString(),
    });

    const result = await getInterface().app.exportSettings(
        "narraleaf-studio-settings.json",
        serializeSettingsDocument(document),
    );
    if (!result.success) {
        throw new Error(result.error ?? translate("settings.transfer.exportFailed"));
    }
    return result.data;
}

/**
 * Read a document and work out what importing it would change - without changing anything.
 *
 * Returns null when the author cancelled the picker. Throws with a sentence they can act on when
 * the file is not a document this build reads; a hand-edited settings file is the normal case, so
 * that sentence matters more than it usually would.
 */
export async function planImport(): Promise<{ plan: SettingsImportPlan; filePath: string } | null> {
    const picked = await getInterface().app.importSettings();
    if (!picked.success) {
        throw new Error(picked.error ?? translate("settings.transfer.importFailed"));
    }
    if (picked.data.canceled || !picked.data.content) {
        return null;
    }
    const all = await getInterface().app.state.getAllGlobalState();
    if (!all.success) {
        throw new Error(all.error ?? translate("settings.persistFailed"));
    }
    const document = parseSettingsDocument(picked.data.content);
    return {
        plan: planSettingsImport(document, settingsValueSpecs(), all.data.settings),
        filePath: picked.data.filePath ?? "",
    };
}

/**
 * Write the plan's applicable entries.
 *
 * One `setGlobalState` per key rather than a bulk write, so every open window gets the ordinary
 * broadcast for each - the language switches, the theme flips, the zoom re-applies, exactly as if
 * the author had changed them by hand.
 */
export async function applyImport(plan: SettingsImportPlan): Promise<number> {
    let applied = 0;
    for (const entry of plan.applicable) {
        const result = await getInterface().app.state.setGlobalState(
            entry.key as GlobalStateKeys,
            entry.incoming as GlobalStateValue<GlobalStateKeys>,
        );
        if (!result.success) {
            throw new Error(result.error ?? translate("settings.persistFailed"));
        }
        applied += 1;
    }
    return applied;
}
