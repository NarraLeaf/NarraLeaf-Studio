/**
 * Resume and the three steps, in the order DevTools puts them - the muscle memory an author
 * already has for a debugger is worth more here than any rearrangement.
 */

import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Pause, Play, Redo2 } from "lucide-react";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import type { BlueprintDebugSession, BlueprintDebugSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
import { useDevModeReadOnly } from "../../devModeReadOnly";

export function BlueprintDebuggerToolbar(props: {
    session: BlueprintDebugSession | null;
    snapshot: BlueprintDebugSnapshot;
    className?: string;
}): ReactNode {
    const { session, snapshot, className } = props;
    const { t } = useTranslation();
    const paused = snapshot.status === "paused";
    // While an agent holds the session the author may not pause or step its game. Resume stays: it
    // only lets a game a breakpoint stopped go on, which is what the agent needs too.
    const readOnly = useDevModeReadOnly();

    return (
        <div className={`flex items-center gap-0.5 ${className ?? ""}`}>
            {paused ? (
                <ToolbarButton
                    size="sm"
                    aria-label={t("devMode.debugger.resume")}
                    data-tip={t("devMode.debugger.resume")}
                    onClick={() => session?.resume()}
                >
                    <Play className="h-3.5 w-3.5 text-primary" aria-hidden />
                </ToolbarButton>
            ) : (
                <ToolbarButton
                    size="sm"
                    active={snapshot.pausePending}
                    disabled={readOnly}
                    aria-label={t("devMode.debugger.pause")}
                    data-tip={t("devMode.debugger.pause")}
                    onClick={() =>
                        snapshot.pausePending ? session?.cancelPauseRequest() : session?.requestPause()
                    }
                >
                    <Pause className="h-3.5 w-3.5" aria-hidden />
                </ToolbarButton>
            )}
            <ToolbarButton
                size="sm"
                disabled={!paused || readOnly}
                aria-label={t("devMode.debugger.stepOver")}
                data-tip={t("devMode.debugger.stepOver")}
                onClick={() => session?.stepOver()}
            >
                <Redo2 className="h-3.5 w-3.5" aria-hidden />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                disabled={!paused || readOnly}
                aria-label={t("devMode.debugger.stepInto")}
                data-tip={t("devMode.debugger.stepInto")}
                onClick={() => session?.stepInto()}
            >
                <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                disabled={!paused || readOnly}
                aria-label={t("devMode.debugger.stepOut")}
                data-tip={t("devMode.debugger.stepOut")}
                onClick={() => session?.stepOut()}
            >
                <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden />
            </ToolbarButton>
        </div>
    );
}
