import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import {
    PERSONAL_PREFERENCE_KEYS,
    preferenceKeys,
    settingsValueSpecs,
    WALLPAPER_PREFERENCE_KEYS,
} from "@/lib/settings/settingsScope";
import {
    composeSettingsDocument,
    parseSettingsDocument,
    planSettingsImport,
    serializeSettingsDocument,
    SETTINGS_DOCUMENT_MAX_WALLPAPER_BYTES,
    type SettingsDocumentWallpaper,
    type SettingsImportPlan,
} from "@shared/utils/settingsDocument";
import type { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";

/**
 * What an export carries beyond the plain preferences.
 *
 * Both default ON. The feature is "move my Studio to my other machine", and on that machine you
 * want your wallpaper and your own name on your own commits; leaving them out by default made the
 * toggles look like the answer to a question nobody had asked. They remain toggles for the other
 * case - an export handed to someone else - and because the picture is the one thing here that can
 * be megabytes.
 */
export type SettingsExportOptions = {
    /** The workspace wallpaper: the four display keys AND the picture itself. */
    includeWallpaper: boolean;
    /** The name and address recorded on commits. */
    includeIdentity: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: SettingsExportOptions = {
    includeWallpaper: true,
    includeIdentity: true,
};

function exportableKeys(options: SettingsExportOptions): string[] {
    const excluded = new Set<string>([
        ...(options.includeWallpaper ? [] : WALLPAPER_PREFERENCE_KEYS),
        ...(options.includeIdentity ? [] : PERSONAL_PREFERENCE_KEYS),
    ]);
    return preferenceKeys().filter(key => !excluded.has(key));
}

/**
 * Read the wallpaper's bytes so the document can carry them.
 *
 * Returns null - and the export goes ahead without the picture - when there is no wallpaper, when
 * the cached file has gone, or when it is over the budget. Never throws: a picture is the least
 * important thing in the document and must not be able to stop the rest of it being written.
 */
async function readWallpaper(fileName: unknown): Promise<SettingsDocumentWallpaper | null> {
    if (typeof fileName !== "string" || !fileName.trim()) {
        return null;
    }
    try {
        const result = await getInterface().app.readBackgroundImage(fileName);
        const data = result.success ? result.data.data : null;
        if (!data || data.byteLength === 0 || data.byteLength > SETTINGS_DOCUMENT_MAX_WALLPAPER_BYTES) {
            return null;
        }
        const dot = fileName.lastIndexOf(".");
        return {
            fileName,
            extension: dot >= 0 ? fileName.slice(dot).toLowerCase() : ".png",
            dataBase64: base64FromBytes(data),
        };
    } catch {
        return null;
    }
}

/** Base64 without Node's Buffer, which the renderer does not have. */
function base64FromBytes(bytes: Uint8Array): string {
    let binary = "";
    // Chunked: `String.fromCharCode(...bytes)` on a multi-megabyte picture overflows the argument
    // limit and throws, which is the kind of failure that only shows up on someone's real wallpaper.
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
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
    const wallpaper = options.includeWallpaper
        ? await readWallpaper(stored["ui.backgroundImage"])
        : null;
    const document = composeSettingsDocument({
        settings,
        studioVersion: info.success ? info.data.version : "",
        platform: platform.success ? platform.data.system : "",
        exportedAt: new Date().toISOString(),
        ...(wallpaper ? { wallpaper } : {}),
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
    // The picture goes in FIRST, so `ui.backgroundImage` never names a file that is not there yet -
    // every open window repaints the moment that key is broadcast. The cache name is derived from
    // the content, so it comes back identical to the one in the document; it is used rather than
    // assumed, in case a future cache changes how it names things.
    if (plan.document.wallpaper) {
        try {
            const written = await getInterface().app.writeBackgroundImage(
                bytesFromBase64(plan.document.wallpaper.dataBase64),
                plan.document.wallpaper.extension,
            );
            if (written.success) {
                for (const entry of plan.applicable) {
                    if (entry.key === "ui.backgroundImage") {
                        entry.incoming = written.data.file;
                    }
                }
            }
        } catch {
            // A wallpaper that will not decode must not stop the settings being applied; the
            // background key then names a file this machine lacks, which reads as no wallpaper.
        }
    }

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
