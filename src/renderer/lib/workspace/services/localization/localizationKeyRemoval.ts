/**
 * Removing a named key without leaving anything naming it.
 *
 * A widget that read its words from the key is turned into one that holds the key's words itself,
 * and the key's translations become that widget's own (`ui:<elementId>.<prop>`), so every widget
 * shows in every language what it showed before the key went. A blueprint node naming the key is
 * left as it is - it is listed in the confirmation, reads as the key's name from now on, and the
 * project check reports it.
 *
 * Comments in English per project convention.
 */

import { localizationKeyUnitId, type LocalizationUnit } from "@shared/types/localization";
import { uiTextUnitId } from "@shared/types/ui-editor/textSource";

/** What removing a key needs of the two services it changes. */
export type LocalizationKeyRemovalPorts = {
    localization: {
        getKeysIfLoaded(): { keys: Record<string, { sourceText: string }> } | undefined;
        getConfiguration(): { sourceLocale: string; locales: readonly { code: string }[] };
        loadDocument(locale: string): Promise<{ units: Record<string, LocalizationUnit> }>;
        applyUnitEdits(locale: string, edit: { set: Readonly<Record<string, LocalizationUnit>>; remove: readonly string[] }): void;
        removeKey(name: string): unknown;
    };
    interfaceDocument: {
        giveKeyedWidgetsTheirWords(keyName: string, words: string): { elementId: string; prop: string }[];
    } | null;
};

/**
 * Remove `keyName`, turning the widgets that use it into widgets that hold its words and its
 * translations. Returns how many widgets were turned.
 *
 * The translations are copied before the key goes, from every language the project declares except
 * its source language. A language whose file cannot be read keeps nothing for the widget, as it kept
 * nothing readable for the key.
 */
export async function removeLocalizationKeyKeepingWords(
    ports: LocalizationKeyRemovalPorts,
    keyName: string,
): Promise<number> {
    const words = ports.localization.getKeysIfLoaded()?.keys[keyName]?.sourceText ?? "";
    const converted = ports.interfaceDocument?.giveKeyedWidgetsTheirWords(keyName, words) ?? [];
    if (converted.length > 0) {
        const config = ports.localization.getConfiguration();
        for (const { code } of config.locales) {
            if (code === config.sourceLocale) {
                continue;
            }
            let units: Record<string, LocalizationUnit>;
            try {
                units = (await ports.localization.loadDocument(code)).units;
            } catch {
                continue;
            }
            const unit = units[localizationKeyUnitId(keyName)];
            const unitIds = converted.map(site => uiTextUnitId(site.elementId, site.prop));
            // Where the key had no translation the widget showed the key's words, and a translation
            // its own unit happened to hold would be read in their place from now on.
            ports.localization.applyUnitEdits(code, unit?.target
                ? { set: Object.fromEntries(unitIds.map(unitId => [unitId, { ...unit }])), remove: [] }
                : { set: {}, remove: unitIds.filter(unitId => units[unitId]) });
        }
    }
    ports.localization.removeKey(keyName);
    return converted.length;
}
