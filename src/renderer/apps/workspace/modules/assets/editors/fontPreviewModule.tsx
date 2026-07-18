import { Type } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../../types";
import { FontPreviewEditor } from "./FontPreviewEditor";

export const fontPreviewModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:font-preview",
        get title() { return translate("placeholders.moduleTitles.fontPreview"); },
        icon: <Type className="w-4 h-4" />,
        closable: true,
    },
    component: FontPreviewEditor,
};
