import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { DevModeContent } from "./components/DevModeContent";
import { useDevModePayload } from "./hooks/useDevModePayload";

export function DevModeApp() {
    const { t } = useTranslation();
    const {
        bundle,
        entry,
        projectPath,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        clearSessionError,
    } = useDevModePayload();

    return (
        <AppLayout title={t("devMode.title")} iconSrc="/favicon.ico">
            <div className="h-full w-full min-h-0 bg-surface overflow-hidden">
                <DevModeContent
                    bundle={bundle}
                    entry={entry}
                    projectPath={projectPath}
                    surface={surface}
                    surfaceId={surfaceId}
                    rendererRegistry={rendererRegistry}
                    scale={scale}
                    handleAspectUpdate={handleAspectUpdate}
                    sessionError={sessionError}
                    onDismissSessionError={clearSessionError}
                />
            </div>
        </AppLayout>
    );
}

export default DevModeApp;
