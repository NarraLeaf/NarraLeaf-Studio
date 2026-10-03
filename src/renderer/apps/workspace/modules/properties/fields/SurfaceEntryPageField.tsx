import { LogIn } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";

/**
 * The way to make this page the one the game starts on.
 *
 * Shown only on a page that is not the entry already: the entry page says so in the Type row above,
 * and there is nothing to press on it - a game always has one entry, so the way to stop a page being
 * it is to make another page the entry. The same gesture as the page's menu in the interface panel,
 * and the same undo step.
 */
export function SurfaceEntryPageField({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    return (
        <Button size="sm" onClick={() => data.documentService.setEntrySurface(data.surface.id)}>
            <LogIn className="h-3.5 w-3.5" aria-hidden />
            {t("uiEditor.panel.setEntryPage")}
        </Button>
    );
}
