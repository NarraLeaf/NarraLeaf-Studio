import { Languages } from "lucide-react";
import type { EditorTabDefinition } from "../../registry/types";
import { LocalizationEditorTab } from "./LocalizationEditorTab";
import { getLocalizationEditorTabId, type LocalizationEditorTabPayload } from "./localizationEditorTabId";

export function createLocalizationEditorTab(
    locale: string,
    title: string,
    reveal?: LocalizationEditorTabPayload["reveal"],
    orphans?: LocalizationEditorTabPayload["orphans"],
): EditorTabDefinition<LocalizationEditorTabPayload> {
    return {
        id: getLocalizationEditorTabId(locale),
        title,
        icon: <Languages className="h-4 w-4" />,
        component: LocalizationEditorTab,
        payload: { locale, ...(reveal ? { reveal } : {}), ...(orphans ? { orphans } : {}) },
        closable: true,
        modified: false,
    };
}
