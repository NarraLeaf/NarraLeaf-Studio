import { Eye } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel, Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { ZOOM_PERCENT_STEPS } from "@shared/constants/zoom";
import { useOnboardingPreferences } from "../onboardingPreferences";

/**
 * How large Studio's interface is drawn.
 *
 * **The window is the sample**, and that is not a shortcut: `ui.zoomPercent` is applied by the main
 * process to every Studio window's webContents, including this one, so picking a step re-draws the
 * screen it was picked on. The pane on the right grows with it - which is the honest thing for it to
 * do, because that is what will happen to the editor.
 *
 * What that pane cannot show is a whole window at a size, which is the question this screen is
 * actually about - so this is where the preview opens at full size. It comes back with a zoom
 * control of its own in its title bar, and it is a real window at the real setting: the way to
 * judge 125% is to have a window that size in front of you.
 *
 * The ladder rather than a free number, and a dropdown rather than a slider. The ladder is the one
 * Cmd/Ctrl +/- already walks (`ZOOM_PERCENT_STEPS`), so the setting and the shortcut cannot disagree
 * about what "the next size up" is; and a slider dragged here would be a slider that resizes itself
 * under the pointer, which is the one control this preference must not be.
 */
export function ZoomStep() {
    const { t } = useTranslation();
    const { zoomPercent, setZoomPercent } = useOnboardingPreferences();

    return (
        <div className="space-y-4">
            <div>
                <FieldLabel as="div">{t("settings.items.zoomPercent.label")}</FieldLabel>
                <div className="w-40">
                    <Select
                        fullWidth
                        options={ZOOM_PERCENT_STEPS.map(step => ({ value: String(step), label: `${step}%` }))}
                        value={String(zoomPercent)}
                        onChange={value => setZoomPercent(Number(value))}
                        ariaLabel={t("settings.items.zoomPercent.label")}
                    />
                </div>
            </div>

            {/* Raised by the main process: a second window is a window, and the renderer has no way
                to make one. A failure is swallowed - the pane beside these questions is still there,
                and a sentence about a window that did not open would be the loudest thing on a
                screen about how big to draw the interface. */}
            <Button
                variant="secondary"
                onClick={() => void getInterface().app.openOnboardingPreview().catch(() => undefined)}
            >
                <Eye className="h-4 w-4" />
                {t("onboarding.previewWindow.open")}
            </Button>
        </div>
    );
}
