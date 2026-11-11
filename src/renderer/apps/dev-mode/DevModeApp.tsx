import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { DevModeContent } from "./components/DevModeContent";
import { useDevModePayload } from "./hooks/useDevModePayload";
import { useAgentHold } from "./hooks/useAgentHold";
import { AGENT_HOLD_SHIELD_ATTRIBUTE } from "./agentHoldShield";

export function DevModeApp() {
    const { t } = useTranslation();
    const {
        bundle,
        entry,
        launchRequest,
        projectPath,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        clearSessionError,
    } = useDevModePayload();
    const agentHeld = useAgentHold();

    return (
        <AppLayout title={t(agentHeld ? "devMode.agentHeldTitle" : "devMode.title")}>
            <div className="relative h-full w-full min-h-0 bg-surface overflow-hidden">
                <DevModeContent
                    bundle={bundle}
                    entry={entry}
                    launchRequest={launchRequest}
                    projectPath={projectPath}
                    surface={surface}
                    surfaceId={surfaceId}
                    rendererRegistry={rendererRegistry}
                    scale={scale}
                    handleAspectUpdate={handleAspectUpdate}
                    sessionError={sessionError}
                    onDismissSessionError={clearSessionError}
                />
                {agentHeld ? (
                    // Takes every pointer event over the game, the hover included, so the author can
                    // watch the agent's play-test without moving it. Transparent: the title bar says
                    // why, and the agent's own screenshots of the window must not show it.
                    <div
                        {...{ [AGENT_HOLD_SHIELD_ATTRIBUTE]: "" }}
                        aria-hidden
                        className="absolute inset-0 cursor-not-allowed"
                        style={{ zIndex: 2147483647 }}
                        onContextMenu={event => event.preventDefault()}
                    />
                ) : null}
            </div>
        </AppLayout>
    );
}

export default DevModeApp;
