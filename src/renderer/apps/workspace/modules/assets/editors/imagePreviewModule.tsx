import { Image } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../../types";
import { ImagePreviewEditor } from "./ImagePreviewEditor";

/**
 * Image preview editor module
 * Opens images in a preview editor with zoom and pan controls
 */
export const imagePreviewModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:image-preview",
        get title() { return translate("placeholders.moduleTitles.imagePreview"); },
        icon: <Image className="w-4 h-4" />,
        closable: true,
    },
    component: ImagePreviewEditor,
};

