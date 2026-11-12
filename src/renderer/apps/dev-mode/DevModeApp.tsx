import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { DevModeContent } from "./components/DevModeContent";
import { useDevModePayload } from "./hooks/useDevModePayload";
import { useAgentHold } from "./hooks/useAgentHold";
import { getInterface } from "@/lib/app/bridge";
import { AgentHoldCapsule } from "./components/AgentHoldCapsule";
import { DevModeReadOnlyContext } from "./devModeReadOnly";

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
    const agentHold = useAgentHold();
    const agentHeld = agentHold.held;
    const client = agentHold.client ?? t("devMode.agentHeldFallbackClient");

    return (
        <DevModeReadOnlyContext.Provider value={agentHeld}>
        <AppLayout title={t("devMode.title")}>
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
                    // The author's way in: the session becomes theirs and the agent is paused until
                    // they resume it (`DevModeManager.takeOverFromAgent`).
                    <AgentHoldCapsule
                        title={t("devMode.agentHeldCapsule", { client })}
                        detail={t("devMode.agentHeldReadOnly")}
                        action={t("devMode.agentTakeOver")}
                        actionId="take-over"
                        onAction={() => {
                            if (projectPath) {
                                void getInterface().devMode.takeOverFromAgent(projectPath);
                            }
                        }}
                    />
                ) : agentHold.takenOver ? (
                    // And back out: the agent holds it again and is resumed (`handBackToAgent`).
                    <AgentHoldCapsule
                        title={t("devMode.agentTakenOverCapsule")}
                        detail={t("devMode.agentTakenOverPaused", { client })}
                        action={t("devMode.agentHandBack")}
                        actionId="hand-back"
                        onAction={() => {
                            if (projectPath) {
                                void getInterface().devMode.handBackToAgent(projectPath);
                            }
                        }}
                    />
                ) : null}
            </div>
        </AppLayout>
        </DevModeReadOnlyContext.Provider>
    );
}

export default DevModeApp;
