import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { exportablePreferenceKeys, settingsValueSpecs } from "@/lib/settings/settingsScope";
import {
    composeSettingsDocument,
    parseSettingsDocument,
    planSettingsImport,
    serializeSettingsDocument,
    type SettingsImportPlan,
} from "@shared/utils/settingsDocument";
import type { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import type { TeamStudioConfigRefusal } from "@shared/types/team";

/**
 * The author's preferences as the text of a settings document.
 *
 * Only keys that are actually stored are written out: a document listing every default would be
 * three times the size and would, on import, present thirty rows of "no change" for the author to
 * read past.
 */
async function composeCurrentDocument(): Promise<string> {
    const [all, info] = await Promise.all([
        getInterface().app.state.getAllGlobalState(),
        getInterface().getAppInfo(),
    ]);
    if (!all.success) {
        throw new Error(all.error ?? translate("settings.persistFailed"));
    }
    const stored = all.data.settings;
    const settings: Record<string, unknown> = {};
    for (const key of exportablePreferenceKeys()) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
            settings[key] = stored[key];
        }
    }

    const platform = await getInterface().getPlatform();
    return serializeSettingsDocument(composeSettingsDocument({
        settings,
        studioVersion: info.success ? info.data.version : "",
        platform: platform.success ? platform.data.system : "",
        exportedAt: new Date().toISOString(),
    }));
}

/** What importing a document's text would change, against what is stored now. */
async function planFromText(content: string): Promise<SettingsImportPlan> {
    const all = await getInterface().app.state.getAllGlobalState();
    if (!all.success) {
        throw new Error(all.error ?? translate("settings.persistFailed"));
    }
    return planSettingsImport(parseSettingsDocument(content), settingsValueSpecs(), all.data.settings);
}

/** Write the author's preferences to a file they pick. */
export async function exportSettings(): Promise<{ canceled: boolean; filePath?: string }> {
    const result = await getInterface().app.exportSettings("narraleaf-studio-settings.json", await composeCurrentDocument());
    if (!result.success) {
        throw new Error(result.error ?? translate("settings.transfer.exportFailed"));
    }
    return result.data;
}

/**
 * Keep the author's preferences on a Team server, for the next computer they sign in from.
 *
 * The same document an export writes, so a backup and a file are interchangeable: the web console
 * offers the kept copy as a download, and a downloaded one imports here like any other.
 */
export async function backupToTeam(remoteOrigin: string): Promise<void> {
    const content = await composeCurrentDocument();
    const answered = await getInterface().team.studioConfig({ remoteOrigin, action: "upload", content });
    if (!answered.success) {
        throw new Error(answered.error ?? translate("settings.transfer.team.failed"));
    }
    if (!answered.data.ok) {
        throw new Error(teamRefusal(answered.data.reason, answered.data.message, "upload"));
    }
}

/**
 * Read the preferences kept on a Team server and work out what restoring them would change.
 *
 * Returns null when the server keeps nothing for this account yet. What comes back is held to the
 * same reading as a file the author picked - it is a document someone could have edited.
 */
export async function planTeamRestore(remoteOrigin: string): Promise<SettingsImportPlan | null> {
    const answered = await getInterface().team.studioConfig({ remoteOrigin, action: "download" });
    if (!answered.success) {
        throw new Error(answered.error ?? translate("settings.transfer.team.failed"));
    }
    if (!answered.data.ok) {
        throw new Error(teamRefusal(answered.data.reason, answered.data.message, "download"));
    }
    if (answered.data.content === undefined) {
        return null;
    }
    return await planFromText(answered.data.content);
}

/** A refusal as a sentence the author can act on. */
function teamRefusal(reason: TeamStudioConfigRefusal, message: string | undefined, action: "upload" | "download"): string {
    switch (reason) {
        case "signed-out":
            return translate("settings.transfer.team.signedOut");
        case "forbidden":
            return translate(action === "upload" ? "settings.transfer.team.forbiddenUpload" : "settings.transfer.team.forbidden");
        case "too-large":
            return translate("settings.transfer.team.tooLarge");
        case "unsupported":
            return translate("settings.transfer.team.unsupported");
        case "unreachable":
            return translate("settings.transfer.team.unreachable");
        case "failed":
            return message ?? translate("settings.transfer.team.failed");
    }
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
    return {
        plan: await planFromText(picked.data.content),
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
