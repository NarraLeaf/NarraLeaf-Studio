/**
 * Words a plugin offers for translation - what an author writes in a plugin's own editor and a player
 * reads in the game: a menu row's label, a gallery entry's name.
 *
 * Studio's own model knows nothing of a menu bar or a gallery, so it cannot walk their documents for
 * words the way it walks the interface document. The plugin lists them instead
 * (`app.services.localization.registerWords`), and the translation table, its exports and its progress
 * read the lists here beside the interface's words. Each word has a unit of its own,
 * `plugin:<pluginId>/<id>` (`pluginWordsUnitId`), which the plugin's runtime entry reads back in the
 * player's language (`app.game.locale.words`) and the menu bar resolves when it is drawn.
 *
 * A view, as the contributed-widget sources are: a list is read when asked, so a plugin switched off
 * stops offering its words in the same instant.
 *
 * Comments in English per project convention.
 */

import { isValidPluginWordsId, pluginWordsUnitId } from "@shared/types/localization";
import { uiTextHasWords } from "@shared/types/ui-editor/textSource";

/** One of a plugin's words, as the plugin lists it. */
export type PluginWordsEntry = {
    /** The plugin's own id for the words (letters, digits, `.`, `_`, `-`). */
    id: string;
    /** The words, in the project's source language. */
    text: string;
    /** Where a player meets the words, for a translator: "File › Save". */
    context?: string;
};

/** What a plugin registers: its words as they are now, and a way to hear that they changed. */
export type PluginWordsSource = {
    list(): readonly PluginWordsEntry[];
    subscribe?(listener: () => void): () => void;
};

/** One of a plugin's words as a translation-table row. */
export type PluginWordsRow = {
    unitId: string;
    pluginId: string;
    /** The plugin's name in the editor's language, which the table groups its words under. */
    pluginName: string;
    sourceText: string;
    context: string;
};

type Registration = {
    pluginId: string;
    pluginName: () => string;
    source: PluginWordsSource;
};

const registrations = new Set<Registration>();
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

/**
 * Offer a plugin's words to the translation table. Returns the removal, which also drops the
 * subscription the source was given.
 */
export function registerPluginWords(pluginId: string, pluginName: () => string, source: PluginWordsSource): () => void {
    const registration: Registration = { pluginId, pluginName, source };
    registrations.add(registration);
    const unsubscribe = source.subscribe?.(notify);
    notify();
    return () => {
        if (registrations.delete(registration)) {
            unsubscribe?.();
            notify();
        }
    };
}

/** Hear when any plugin's words may have changed. Returns the unsubscribe. */
export function subscribePluginWords(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Every word the loaded plugins offer, as translation rows, plugin by plugin in the order each lists
 * them. Words with no letter in them read the same in every language and have no row, as a widget's
 * own words have none; an id that is not one, or that a plugin lists twice, is left out - the unit
 * could not be told apart. A list that throws drops only that plugin's words.
 */
export function listPluginWordsRows(): PluginWordsRow[] {
    const rows: PluginWordsRow[] = [];
    const seen = new Set<string>();
    for (const { pluginId, pluginName, source } of registrations) {
        let entries: readonly PluginWordsEntry[];
        try {
            entries = source.list();
        } catch (error) {
            console.error(`[plugin:${pluginId}] listing its words for translation failed:`, error);
            continue;
        }
        let name = pluginId;
        try {
            name = pluginName() || pluginId;
        } catch {
            // A name that cannot be read is shown by the plugin's id.
        }
        for (const entry of entries ?? []) {
            if (!entry || !isValidPluginWordsId(entry.id) || typeof entry.text !== "string" || !uiTextHasWords(entry.text)) {
                continue;
            }
            const unitId = pluginWordsUnitId(pluginId, entry.id);
            if (seen.has(unitId)) {
                continue;
            }
            seen.add(unitId);
            rows.push({
                unitId,
                pluginId,
                pluginName: name,
                sourceText: entry.text,
                context: typeof entry.context === "string" && entry.context.trim() ? entry.context : name,
            });
        }
    }
    return rows;
}
