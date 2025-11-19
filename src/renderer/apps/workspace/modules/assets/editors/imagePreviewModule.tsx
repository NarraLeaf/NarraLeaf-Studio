import { Image } from "lucide-react";
import { EditorModule } from "../../types";
import { ImagePreviewEditor } from "./ImagePreviewEditor";

/**
 * Image preview editor module
 * Opens images in a preview editor with zoom and pan controls
 */
export const imagePreviewModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:image-preview",
        title: "Image Preview",
        icon: <Image className="w-4 h-4" />,
        closable: true,
    },
    component: ImagePreviewEditor,
};

