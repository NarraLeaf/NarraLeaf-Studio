import { Languages } from "lucide-react";
import type { EditorTabDefinition } from "../../registry/types";
import { LocalizationEditorTab } from "./LocalizationEditorTab";
import { getLocalizationEditorTabId, type LocalizationEditorTabPayload } from "./localizationEditorTabId";

export function createLocalizationEditorTab(locale: string, title: string): EditorTabDefinition<LocalizationEditorTabPayload> {
    return {
        id: getLocalizationEditorTabId(locale),
        title,
        icon: <Languages className="h-4 w-4" />,
        component: LocalizationEditorTab,
        payload: { locale },
        closable: true,
        modified: false,
    };
}
