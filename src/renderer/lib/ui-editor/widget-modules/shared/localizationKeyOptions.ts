/**
 * Named-localization-key picker options for widget inspectors: users choose by
 * source text (primary label) with the key name as the secondary label, instead
 * of typing raw keys. Reads the preloaded key registry from the workspace
 * LocalizationService singleton; degrades to just "None" outside a workspace.
 * Comments in English per project convention.
 */

import type { SelectOption } from "@/apps/workspace/modules/properties/framework/types";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";

export function listLocalizationKeyOptions(): SelectOption[] {
    let keys: Record<string, { sourceText: string }> = {};
    try {
        keys = LocalizationService.getInstance().getKeysIfLoaded()?.keys ?? {};
    } catch {
        // Outside a workspace context; offer only "None".
    }
    return [
        { value: "", label: "None" },
        ...Object.entries(keys)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, definition]) => ({
                value: name,
                label: definition.sourceText.trim() || name,
                secondaryLabel: name,
            })),
    ];
}
