import { Mic } from "lucide-react";
import type { EditorTabDefinition } from "../../registry/types";
import { VoiceEditorTab } from "./VoiceEditorTab";
import { getVoiceEditorTabId, type VoiceEditorTabPayload } from "./voiceEditorTabId";

export function createVoiceEditorTab(
    locale: string,
    title: string,
    reveal?: VoiceEditorTabPayload["reveal"],
): EditorTabDefinition<VoiceEditorTabPayload> {
    return {
        id: getVoiceEditorTabId(locale),
        title,
        icon: <Mic className="h-4 w-4" />,
        component: VoiceEditorTab,
        payload: reveal ? { locale, reveal } : { locale },
        closable: true,
        modified: false,
    };
}
