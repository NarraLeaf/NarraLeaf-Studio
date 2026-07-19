import { Braces } from "lucide-react";
import { translate } from "@/lib/i18n";
import { EditorModule } from "../../types";
import { JsonPreviewEditor } from "./JsonPreviewEditor";

export const jsonPreviewModule: EditorModule = {
    metadata: {
        id: "narraleaf-studio:json-preview",
        get title() { return translate("placeholders.moduleTitles.jsonPreview"); },
        icon: <Braces className="w-4 h-4" />,
        closable: true,
    },
    component: JsonPreviewEditor,
};
