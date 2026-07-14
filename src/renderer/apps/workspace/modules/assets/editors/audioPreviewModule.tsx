import { Music } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../../types";
import { AudioPreviewEditor } from "./AudioPreviewEditor";

/**
 * Audio preview editor module
 * Opens audio assets in a preview editor with playback controls
 */
export const audioPreviewModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:audio-preview",
        get title() { return translate("placeholders.moduleTitles.audioPreview"); },
        icon: <Music className="w-4 h-4" />,
        closable: true,
    },
    component: AudioPreviewEditor,
};
