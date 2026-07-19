import { Film } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../../types";
import { VideoPreviewEditor } from "./VideoPreviewEditor";

export const videoPreviewModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:video-preview",
        get title() { return translate("placeholders.moduleTitles.videoPreview"); },
        icon: <Film className="w-4 h-4" />,
        closable: true,
    },
    component: VideoPreviewEditor,
};
