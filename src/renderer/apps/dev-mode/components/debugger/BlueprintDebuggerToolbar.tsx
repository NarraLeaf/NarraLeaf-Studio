/**
 * Resume and the three steps, in the order DevTools puts them - the muscle memory an author
 * already has for a debugger is worth more here than any rearrangement.
 */

import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Pause, Play, Redo2 } from "lucide-react";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import type { BlueprintDebugSession, BlueprintDebugSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";

export function BlueprintDebuggerToolbar(props: {
    session: BlueprintDebugSession | null;
    snapshot: BlueprintDebugSnapshot;
    className?: string;
}): ReactNode {
    const { session, snapshot, className } = props;
    const { t } = useTranslation();
    const paused = snapshot.status === "paused";

    return (
        <div className={`flex items-center gap-0.5 ${className ?? ""}`}>
            {paused ? (
                <ToolbarButton
                    size="sm"
                    aria-label={t("devMode.debugger.resume")}
                    title={t("devMode.debugger.resume")}
                    onClick={() => session?.resume()}
                >
                    <Play className="h-3.5 w-3.5 text-primary" aria-hidden />
                </ToolbarButton>
            ) : (
                <ToolbarButton
                    size="sm"
                    active={snapshot.pausePending}
                    aria-label={t("devMode.debugger.pause")}
                    title={t("devMode.debugger.pause")}
                    onClick={() =>
                        snapshot.pausePending ? session?.cancelPauseRequest() : session?.requestPause()
                    }
                >
                    <Pause className="h-3.5 w-3.5" aria-hidden />
                </ToolbarButton>
            )}
            <ToolbarButton
                size="sm"
                disabled={!paused}
                aria-label={t("devMode.debugger.stepOver")}
                title={t("devMode.debugger.stepOver")}
                onClick={() => session?.stepOver()}
            >
                <Redo2 className="h-3.5 w-3.5" aria-hidden />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                disabled={!paused}
                aria-label={t("devMode.debugger.stepInto")}
                title={t("devMode.debugger.stepInto")}
                onClick={() => session?.stepInto()}
            >
                <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                disabled={!paused}
                aria-label={t("devMode.debugger.stepOut")}
                title={t("devMode.debugger.stepOut")}
                onClick={() => session?.stepOut()}
            >
                <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden />
            </ToolbarButton>
        </div>
    );
}
