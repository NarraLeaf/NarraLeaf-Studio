/**
 * What each widget type is called, in both catalogue languages.
 *
 * A module's `displayName` reads the interface language when it is asked, so the names come from
 * asking twice with the store switched in between. The store is put back afterwards: these
 * functions run inside a test process that other suites share.
 *
 * Comments in English per project convention.
 */

import { i18nStore } from "@/lib/i18n";
import { ensureWidgetModulesRegistered, widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { listInsertPaletteModules } from "@/lib/ui-editor/widget-modules/insertPalette";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { bilingual, type CatalogLocale } from "./catalogText";

/** Run `body` with the interface language set to `locale`, then put the previous one back. */
export function withInterfaceLocale<T>(locale: CatalogLocale, body: () => T): T {
    const previous = i18nStore.getLocale();
    i18nStore.setLocale(locale);
    try {
        return body();
    } finally {
        i18nStore.setLocale(previous);
    }
}

export type WidgetNames = ReadonlyMap<string, { zh: string; en: string }>;

/** The widgets an author can insert, in the insert palette's order. */
export async function listAuthorWidgets(): Promise<UIWidgetModule[]> {
    await ensureWidgetModulesRegistered();
    return listInsertPaletteModules();
}

/** Every registered widget type's name, keyed by element type. */
export async function loadWidgetNames(): Promise<WidgetNames> {
    await ensureWidgetModulesRegistered();
    const names = new Map<string, { zh: string; en: string }>();
    for (const module of widgetModuleRegistry.list()) {
        names.set(module.type, {
            zh: withInterfaceLocale("zh", () => module.displayName),
            en: withInterfaceLocale("en", () => module.displayName),
        });
    }
    return names;
}

export function widgetLabel(names: WidgetNames, type: string): string {
    const name = names.get(type);
    return name ? bilingual(name.zh, name.en) : type;
}
