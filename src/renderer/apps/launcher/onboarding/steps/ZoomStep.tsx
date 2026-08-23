import { useState } from "react";
import { Eye } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel, Input, TabStrip } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { ZOOM_PERCENT_MAX, ZOOM_PERCENT_MIN, normalizeZoomPercent } from "@shared/constants/zoom";
import type { PreviewPanelId } from "../preview/StudioPreview";
import { useOnboardingPreferences } from "../onboardingPreferences";
import { OptionList } from "./OptionList";

/**
 * How large Studio's interface is drawn.
 *
 * **The window is the sample**, and that is not a shortcut: `ui.zoomPercent` is applied by the main
 * process to every Studio window's webContents, including this one, so picking a step re-draws the
 * screen it was picked on.
 *
 * **Three sizes and a box.** The setting's own range is 50-200 in steps of 5, which is thirty-one
 * answers to a question almost everybody answers with one of three - the interface at its size,
 * one step up, and the size a 4K display asks for. The rest is not taken away; it is put behind
 * "Custom", which opens the whole range as a number. That is the shape the canvas zoom control
 * already has in this product.
 *
 * **What the preview shows is a choice here too.** The other screens show the dashboard, which
 * holds still and is mostly type; this one adds the story editor and the console, because a size
 * that reads on a dashboard can still be too small for three columns of monospace, and the only way
 * to know is to look at them. The console is the densest surface in the product and therefore the
 * one that decides.
 *
 * The pane beside these questions shows a quarter of a window. The button below opens the whole of
 * it, maximized, with a zoom control in its own title bar - because the way to judge 125% is to
 * have a window that size in front of you.
 */

/** The three sizes almost every answer is one of. Everything else is behind "Custom". */
const PRESETS = [90, 100, 125] as const;

const CUSTOM = "custom";

export interface ZoomStepProps {
    /** Which surface the pane beside this screen is showing, and the way to change it. */
    surface: PreviewPanelId;
    onSurfaceChange: (surface: PreviewPanelId) => void;
}

export function ZoomStep({ surface, onSurfaceChange }: ZoomStepProps) {
    const { t } = useTranslation();
    const { zoomPercent, setZoomPercent } = useOnboardingPreferences();

    const isPreset = (PRESETS as readonly number[]).includes(zoomPercent);
    /**
     * Whether the box is open. Sticky once opened, so typing a size that happens to be a preset
     * does not close the field the author is still typing in.
     */
    const [customOpen, setCustomOpen] = useState(!isPreset);
    const showCustom = customOpen || !isPreset;

    return (
        <div className="space-y-5">
            <div>
                <FieldLabel as="div">{t("settings.items.zoomPercent.label")}</FieldLabel>
                <OptionList
                    label={t("settings.items.zoomPercent.label")}
                    value={showCustom ? CUSTOM : String(zoomPercent)}
                    options={[
                        ...PRESETS.map(percent => ({ value: String(percent), label: `${percent}%` })),
                        { value: CUSTOM, label: t("onboarding.zoom.custom") },
                    ]}
                    onChange={value => {
                        if (value === CUSTOM) {
                            setCustomOpen(true);
                            return;
                        }
                        setCustomOpen(false);
                        setZoomPercent(Number(value));
                    }}
                />

                {showCustom && (
                    <div className="mt-2 w-32">
                        <Input
                            fullWidth
                            type="number"
                            min={ZOOM_PERCENT_MIN}
                            max={ZOOM_PERCENT_MAX}
                            step={5}
                            value={String(zoomPercent)}
                            aria-label={t("onboarding.zoom.custom")}
                            // Clamped by the same function the main process applies the value
                            // through, so a hand-typed 500 is 200 here and there alike.
                            onChange={event => setZoomPercent(normalizeZoomPercent(event.target.value))}
                        />
                    </div>
                )}
            </div>

            <div>
                <FieldLabel as="div">{t("onboarding.zoom.surface")}</FieldLabel>
                <TabStrip
                    size="sm"
                    activeId={surface}
                    onChange={id => onSurfaceChange(id as PreviewPanelId)}
                    tabs={[
                        { id: "dashboard", label: t("placeholders.moduleTitles.dashboard") },
                        { id: "story", label: t("placeholders.moduleTitles.story") },
                        { id: "console", label: t("placeholders.moduleTitles.console") },
                    ]}
                />
            </div>

            {/* Raised by the main process: a second window is a window, and the renderer has no way
                to make one. A failure is swallowed - the pane beside these questions is still there,
                and a sentence about a window that did not open would be the loudest thing on a
                screen about how big to draw the interface. */}
            <Button
                variant="secondary"
                onClick={() => void getInterface().app.openOnboardingPreview({ surface }).catch(() => undefined)}
            >
                <Eye className="h-4 w-4" />
                {t("onboarding.previewWindow.open")}
            </Button>
        </div>
    );
}
