import { AppLayout } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { DevModeContent } from "./components/DevModeContent";
import { useDevModePayload } from "./hooks/useDevModePayload";
import { useAgentHold } from "./hooks/useAgentHold";
import { Bot } from "lucide-react";
import { AGENT_HOLD_CAPSULE_ATTRIBUTE, AGENT_HOLD_SHIELD_ATTRIBUTE } from "./agentHoldShield";

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
                        {/* Takes every pointer event over the game, the hover included, so the author
                            can watch the agent's play-test without moving it. Transparent: the notice
                            below says why. */}
                        <div
                            {...{ [AGENT_HOLD_SHIELD_ATTRIBUTE]: "" }}
                            aria-hidden
                            className="absolute inset-0 cursor-not-allowed"
                            style={{ zIndex: 2147483646 }}
                            onContextMenu={event => event.preventDefault()}
                        />
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
                                className="flex items-center gap-1.5 rounded-full border border-edge bg-surface-overlay px-3 py-1 text-xs text-fg shadow-md"
                            >
                                <Bot className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                                <span>{t("devMode.agentHeldCapsule", { client: agentHold.client ?? t("devMode.agentHeldFallbackClient") })}</span>
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </AppLayout>
    );
}

export default DevModeApp;
