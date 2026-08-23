import { Eye } from "lucide-react";
import { Select } from "@/lib/components/elements";
import { TitleBar, windowRootProps } from "@/lib/components/layout";
import { TooltipHost } from "@/lib/tooltip";
import { useTranslation } from "@/lib/i18n";
import { ZOOM_PERCENT_STEPS } from "@shared/constants/zoom";
import { WindowControlPolicy } from "@shared/types/window";
import { OnboardingPreferencesProvider, useOnboardingPreferences } from "@/apps/launcher/onboarding/onboardingPreferences";
import { OnboardingServersProvider } from "@/apps/launcher/onboarding/onboardingServers";
import {
    PreviewControlBar,
    PreviewProjectSwitcher,
    StudioPreview,
} from "@/apps/launcher/onboarding/preview/StudioPreview";

/**
 * First-run setup's preview, at full size and in a window of its own.
 *
 * The setup screen has room for the left quarter of a Studio window; this is the rest of it. Same
 * component, same preferences, read the same way - the two windows cannot show different samples,
 * because there is only one sample and it is a function of what is stored.
 *
 * **One title bar, and it is a real one.** The sample's own bar would have been a second bar under
 * the window's, which is where this started and why it looked wrong: the macOS traffic lights sat
 * on a strip of their own with a copy of a workspace's title bar beneath them. So the shared
 * `TitleBar` is given the sample's two clusters to draw instead. The result is the arrangement a
 * workspace has - the buttons in their usual place, the project on the left, the dock toggles on
 * the right - with the notice in the slot a workspace keeps its search box in.
 *
 * The rail's own eye is absent here, and so is everything else it could answer: this is the scene
 * editor, whole, and the rail beside it is furniture. There is nothing left to open.
 */
export function OnboardingPreviewApp() {
    const { t } = useTranslation();

    return (
        <div {...windowRootProps} className="h-screen w-screen bg-surface text-fg">
            <TooltipHost />
            <OnboardingPreferencesProvider>
                <OnboardingServersProvider>
                    <div className="grid h-full grid-rows-[40px,1fr]">
                        <TitleBar
                            title=""
                            iconSrc=""
                            windowControlPolicy={WindowControlPolicy.Standard}
                            actionBar={<PreviewProjectSwitcher />}
                            center={<PreviewNotice />}
                            controlBar={(
                                <span className="flex items-center gap-1 pr-1.5">
                                    <PreviewControlBar />
                                </span>
                            )}
                        />

                        <main className="flex h-full min-h-0 flex-col overflow-hidden">
                            <StudioPreview panel="story" frameClassName="" titleBar={false} />
                        </main>
                    </div>
                </OnboardingServersProvider>
            </OnboardingPreferencesProvider>
        </div>
    );
}

/**
 * What this window is, and the one setting it is here to be judged at.
 *
 * The zoom sits in the title bar rather than on the setup screen behind it because this is where it
 * can be answered: `ui.zoomPercent` is applied by the main process to every window, so a step
 * picked here re-draws this window at that size while it fills the screen - which is the only way
 * to tell 110% from 125% without guessing. It writes the same key the setup screen's own dropdown
 * does, and both follow the broadcast, so the two can never disagree.
 *
 * In the slot a workspace keeps its search box in. Everything else on this bar is a likeness; this
 * strip is the preview speaking for itself, which is why it says so before it offers the control.
 */
function PreviewNotice() {
    const { t } = useTranslation();
    const { zoomPercent, setZoomPercent } = useOnboardingPreferences();

    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                <Eye className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("onboarding.previewWindow.notice")}</span>
            </span>
            <div className="w-24 shrink-0">
                <Select
                    fullWidth
                    size="sm"
                    options={ZOOM_PERCENT_STEPS.map(step => ({ value: String(step), label: `${step}%` }))}
                    value={String(zoomPercent)}
                    onChange={value => setZoomPercent(Number(value))}
                    ariaLabel={t("settings.items.zoomPercent.label")}
                />
            </div>
        </div>
    );
}

export default OnboardingPreviewApp;
