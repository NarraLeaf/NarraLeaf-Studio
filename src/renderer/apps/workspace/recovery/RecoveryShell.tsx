import React from "react";
import { LifeBuoy, LogOut, RefreshCw } from "lucide-react";
import { Button, TitleBar } from "@/lib/components";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { RecoveryPanel } from "./RecoveryPanel";

/**
 * The window a recovery shell puts on screen.
 *
 * A layout of its own rather than `WorkspaceLayout` with fewer panels in it, and that is a decision
 * worth defending because the second option is the obvious one. The real shell is built for a live
 * project: its command palette evaluates `when` predicates against the story library, its quick-open
 * indexes the cast and the interface documents, its status bar reads the preview and the version
 * rail. Every one of those is a service this mode deliberately does not start, so reusing the shell
 * would mean auditing two dozen components for "what if this service never came up" - and getting
 * one wrong would crash the window whose entire promise is that it opens.
 *
 * So the promise is kept structurally: this file renders a title bar, a sidebar, and text. There is
 * nothing here that can fail.
 */
export function RecoveryShell({
    context,
    projectPath,
}: {
    context: WorkspaceContext | null;
    projectPath: string;
}) {
    const { t } = useTranslation();
    const [leaving, setLeaving] = React.useState(false);

    const leave = async () => {
        setLeaving(true);
        try {
            await getInterface().workspace.setRecoveryMode(false);
        } finally {
            // The reload usually gets here first; this only matters if it did not, and a button
            // stuck spinning would be the second thing to go wrong in a row.
            setLeaving(false);
        }
    };

    return (
        <div className="flex h-screen w-screen flex-col bg-surface text-fg">
            <TitleBar title={t("workspace.recovery.windowTitle")} iconSrc="/favicon.ico" />

            {/* The banner is the one thing that must never be missed: everything below it is
                diagnostic, and an author who forgets which mode they are in will eventually try to
                edit something and watch the edit disappear. It says so, and it carries the way out. */}
            <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2">
                <LifeBuoy className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                <p className="min-w-0 flex-1 text-xs text-fg">
                    <span className="font-medium">{t("workspace.recovery.banner.title")}</span>
                    <span className="text-fg-subtle"> — {t("workspace.recovery.banner.detail")}</span>
                </p>
                <Button variant="secondary" size="sm" onClick={() => void leave()} disabled={leaving}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    <span>{t("workspace.recovery.banner.exit")}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void getInterface().workspace.close()}>
                    <LogOut className="h-3.5 w-3.5" aria-hidden />
                    <span>{t("workspace.shell.openLauncher")}</span>
                </Button>
            </div>

            <div className="flex min-h-0 flex-1">
                <aside className="w-[380px] shrink-0 border-r border-edge">
                    <RecoveryPanel context={context} projectPath={projectPath} />
                </aside>
                <main className="min-w-0 flex-1 overflow-auto p-8">
                    <div className="mx-auto max-w-xl">
                        <h2 className="text-base font-semibold text-fg">{t("workspace.recovery.guide.title")}</h2>
                        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-fg-muted">
                            <li>{t("workspace.recovery.guide.step1")}</li>
                            <li>{t("workspace.recovery.guide.step2")}</li>
                            <li>{t("workspace.recovery.guide.step3")}</li>
                            <li>{t("workspace.recovery.guide.step4")}</li>
                        </ol>
                        <p className="mt-4 text-xs text-fg-subtle">{t("workspace.recovery.guide.readOnly")}</p>
                    </div>
                </main>
            </div>
        </div>
    );
}
