import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { Button } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { AgentAccessPromptProps } from "@shared/types/agentAccess";
import { WindowAppType, WindowControlPolicy, type WindowControlAbility } from "@shared/types/window";

const AGENT_ACCESS_WINDOW_CONTROL_ABILITY: WindowControlAbility = {
    minimizable: false,
    maximizable: false,
    closable: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
};

type Translate = ReturnType<typeof useTranslation>["t"];

/** What one kind of question puts on screen. */
type PromptView = {
    title: string;
    warning: boolean;
    /** The boxed identity: who is asking, or where the write lands. */
    box?: ReactNode;
    /** Context, muted. */
    context?: string;
    /** The consequence of agreeing, at full strength. */
    consequence?: string;
    /** Where this can be changed later. */
    footnote?: string;
    confirm: string;
    cancel: string;
};

function describePrompt(prompt: AgentAccessPromptProps, t: Translate): PromptView {
    switch (prompt.kind) {
        case "folderAccess": {
            const client = prompt.clientName?.trim() || t("workspace.agent.confirm.folderAccess.unknownClient");
            const many = prompt.folders.length > 1;
            return {
                title: t("workspace.agent.confirm.folderAccess.title"),
                warning: false,
                box: (
                    <>
                        <div className="text-sm font-medium text-fg" data-agent-access-client>
                            {t(many ? "workspace.agent.confirm.folderAccess.messageMany" : "workspace.agent.confirm.folderAccess.messageOne", { client })}
                        </div>
                        {prompt.folders.map(folder => (
                            <div key={folder} className="mt-1 break-all text-2xs leading-4 text-fg-muted" data-agent-access-folder>
                                {folder}
                            </div>
                        ))}
                    </>
                ),
                context: prompt.reason
                    ? t("workspace.agent.confirm.folderAccess.reason", { client, reason: prompt.reason })
                    : undefined,
                consequence: t("workspace.agent.confirm.folderAccess.detail"),
                footnote: t("workspace.agent.confirm.folderAccess.settings"),
                confirm: t(many ? "workspace.agent.confirm.folderAccess.allowMany" : "workspace.agent.confirm.folderAccess.allowOne"),
                cancel: t("workspace.agent.confirm.folderAccess.deny"),
            };
        }
        case "fullAccess":
            return {
                title: t("workspace.agent.confirm.fullAccess.message"),
                warning: true,
                consequence: t("workspace.agent.confirm.fullAccess.detail"),
                confirm: t("workspace.agent.confirm.fullAccess.allow"),
                cancel: t("common.cancel"),
            };
        case "allowWrites":
            return {
                title: t("workspace.agent.confirm.allowWrites.message"),
                warning: false,
                consequence: t("workspace.agent.confirm.allowWrites.detail"),
                confirm: t("workspace.agent.confirm.allowWrites.allow"),
                cancel: t("common.cancel"),
            };
        case "exportOverwrite":
            return {
                title: t("workspace.agent.confirm.exportSkill.title"),
                warning: true,
                box: (
                    <>
                        <div className="text-sm font-medium text-fg">
                            {t("workspace.agent.confirm.exportSkill.existsMessage", { folder: prompt.folder })}
                        </div>
                        <div className="mt-1 break-all text-2xs leading-4 text-fg-muted">{prompt.path}</div>
                    </>
                ),
                consequence: t("workspace.agent.confirm.exportSkill.existsDetail"),
                confirm: t("workspace.agent.confirm.exportSkill.replace"),
                cancel: t("common.cancel"),
            };
    }
}

/**
 * The questions agent access puts to the author, each in a window of its own: may an agent read
 * these folders, may agents change projects, may they have full access, may the skill export
 * replace what a folder already holds.
 *
 * A window rather than a sheet inside the workspace, for the project-trust window's reason: a
 * workspace runs plugin code, and an answer that widens what an outside program may do must come
 * from a surface that code cannot reach. Everything shown is main's record - the client's name, the
 * folders, the agent's stated purpose - read from this window's own props; the host reads the answer
 * off the close result and acts on it itself.
 *
 * The refusing answer takes the focus, as "Not now" does in the trust window: the mistake within
 * reach is agreeing without meaning to. Escape, and closing the window any other way, is "no".
 */
export function AgentAccessApp() {
    const { t } = useTranslation();
    const [prompt, setPrompt] = useState<AgentAccessPromptProps | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        getInterface()
            .getWindowProps<WindowAppType.AgentAccessPrompt>()
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setError(result.error ?? t("workspace.agent.confirm.loadError"));
                    return;
                }
                setPrompt(result.data);
            })
            .catch(err => {
                if (mounted) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            })
            .finally(() => {
                // Announced either way: the host holds the window hidden until this arrives, and an
                // agent call waiting on the answer would wait on a window nobody can see.
                if (mounted) {
                    getInterface().window.ready();
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    const answer = useCallback((allowed: boolean) => {
        getInterface().window.closeWith<WindowAppType.AgentAccessPrompt>({ allowed });
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                answer(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [answer]);

    const view = prompt ? describePrompt(prompt, t) : null;

    return (
        <AppLayout
            title={t("workspace.agent.confirm.window")}
            initialControlAbility={AGENT_ACCESS_WINDOW_CONTROL_ABILITY}
            windowControlPolicy={WindowControlPolicy.None}
        >
            <div
                className="flex h-full min-h-0 flex-col bg-surface text-fg"
                data-agent-access-prompt={prompt?.kind}
            >
                {!view && !error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-label={t("common.loading")} />
                    </div>
                ) : null}

                {view ? (
                    <>
                        <div className="flex items-center gap-2 border-b border-edge bg-surface-sunken px-4 py-2">
                            {view.warning ? (
                                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                            ) : null}
                            <div className="min-w-0 text-sm font-medium text-fg">{view.title}</div>
                        </div>

                        {/*
                          * The trust window's structure: the identity boxed, then prose in two tones -
                          * what the asker says muted, what agreeing does not - and a footnote in the
                          * small size. A warning question carries its consequence in the warning
                          * tone instead, since that sentence is the whole of what it asks.
                          */}
                        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            {view.box ? (
                                <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2">{view.box}</div>
                            ) : null}
                            {view.context ? (
                                <p
                                    className={cn("break-words text-xs leading-5 text-fg-muted", view.box && "mt-3")}
                                    data-agent-access-reason
                                >
                                    {view.context}
                                </p>
                            ) : null}
                            {view.consequence ? (
                                view.warning ? (
                                    <div
                                        className={cn(
                                            "rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-5 text-fg",
                                            (view.box || view.context) && "mt-3",
                                        )}
                                    >
                                        {view.consequence}
                                    </div>
                                ) : (
                                    <p
                                        className={cn(
                                            "text-xs font-medium leading-5 text-fg",
                                            view.context ? "mt-2" : view.box ? "mt-3" : null,
                                        )}
                                    >
                                        {view.consequence}
                                    </p>
                                )
                            ) : null}
                            {view.footnote ? (
                                <p className="mt-3 text-2xs leading-4 text-fg-subtle">{view.footnote}</p>
                            ) : null}
                        </div>
                    </>
                ) : error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                            {error}
                        </div>
                    </div>
                ) : null}

                {/*
                  * Both answers stay reachable even where the props could not be read: this window
                  * carries no title-bar controls, so a state without these buttons is a window that
                  * cannot be dismissed.
                  */}
                {view || error ? (
                    <div className="grid grid-cols-2 gap-2 border-t border-edge bg-surface-sunken p-3">
                        <Button
                            variant="secondary"
                            size="md"
                            autoFocus
                            data-agent-access-answer="no"
                            onClick={() => answer(false)}
                        >
                            {view?.cancel ?? t("common.cancel")}
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            disabled={!view}
                            data-agent-access-answer="yes"
                            onClick={() => answer(true)}
                        >
                            {view?.confirm ?? t("common.confirm")}
                        </Button>
                    </div>
                ) : null}
            </div>
        </AppLayout>
    );
}

export default AgentAccessApp;
