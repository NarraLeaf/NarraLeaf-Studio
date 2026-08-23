import { FieldLabel, Select } from "@/lib/components/elements";
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
 * The ladder rather than a free number, and a dropdown rather than a slider. The ladder is the one
 * Cmd/Ctrl +/- already walks (`ZOOM_PERCENT_STEPS`), so the setting and the shortcut cannot disagree
 * about what "the next size up" is; and a slider dragged here would be a slider that resizes itself
 * under the pointer, which is the one control this preference must not be.
 */
export function ZoomStep() {
    const { t } = useTranslation();
    const { zoomPercent, setZoomPercent } = useOnboardingPreferences();

    return (
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
    );
}
