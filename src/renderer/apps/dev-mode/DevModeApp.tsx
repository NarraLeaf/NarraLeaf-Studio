import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { DevModeContent } from "./components/DevModeContent";
import { useDevModePayload } from "./hooks/useDevModePayload";
import { useAgentHold } from "./hooks/useAgentHold";
import { Bot } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { AGENT_HOLD_CAPSULE_ATTRIBUTE } from "./agentHoldShield";
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
                    <>
                        {/* Put away while main photographs the window for the agent; see
                            `prepareWindowCapture`. */}
                        {/* Centred by a flex row, not a translate: the engine's stylesheet in this window
                            overrides Tailwind's transform utilities. */}
                        <div
                            className="pointer-events-none absolute inset-x-0 top-3 flex justify-center"
                            style={{ zIndex: 2147483647 }}
                        >
                            <div
                                {...{ [AGENT_HOLD_CAPSULE_ATTRIBUTE]: "" }}
                                role="status"
                                className="pointer-events-auto flex items-center gap-3 rounded-full border border-edge bg-surface-overlay py-1.5 pl-3.5 pr-1.5 shadow-md"
                            >
                                <Bot className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                                <div className="flex flex-col leading-tight">
                                    <span className="text-xs text-fg">
                                        {t("devMode.agentHeldCapsule", { client: agentHold.client ?? t("devMode.agentHeldFallbackClient") })}
                                    </span>
                                    <span className="text-2xs text-fg-muted">{t("devMode.agentHeldReadOnly")}</span>
                                </div>
                                {/* The author's way back: the session becomes theirs and the agent is
                                    paused until they resume it (`DevModeManager.takeOverFromAgent`). */}
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="rounded-full"
                                    data-agent-take-over=""
                                    onClick={() => {
                                        if (projectPath) {
                                            void getInterface().devMode.takeOverFromAgent(projectPath);
                                        }
                                    }}
                                >
                                    {t("devMode.agentTakeOver")}
                                </Button>
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </AppLayout>
        </DevModeReadOnlyContext.Provider>
    );
}

export default DevModeApp;
