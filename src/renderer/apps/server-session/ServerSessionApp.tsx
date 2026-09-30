import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { Button } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { ServerSessionPromptProps } from "@shared/types/serverSession";
import { WindowAppType, WindowControlPolicy, type WindowControlAbility } from "@shared/types/window";

const SERVER_SESSION_WINDOW_CONTROL_ABILITY: WindowControlAbility = {
    minimizable: false,
    maximizable: false,
    closable: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
};

/**
 * One question, in a window of its own: does this project use this sign-in?
 *
 * The window holds the project, the server and the account, what the project has not done yet and
 * what saying yes does. Nothing about how sign-ins are kept: an author reading this is deciding
 * whether a project may act as their account, not learning where tokens live.
 *
 * It is a window rather than a dialog inside the workspace because the workspace renders the
 * project's content, and a question that content could answer is not a question. The host reads
 * the answer off this window's close result and records it itself.
 *
 * "Don't use" takes the focus, as "Not now" does in the trust window: the mistake within reach
 * here is agreeing without meaning to, so the key already held down when the window appears must
 * not be the one that agrees. Escape closes without an answer, which records nothing.
 */
export function ServerSessionApp() {
    const { t } = useTranslation();
    const [prompt, setPrompt] = useState<ServerSessionPromptProps | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        getInterface()
            .getWindowProps<WindowAppType.ServerSessionPrompt>()
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setError(result.error ?? t("serverSession.error.load"));
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
                // Announced either way: the host holds the window hidden until this arrives, and a
                // request waiting on the answer would wait for ever on a window nobody can see.
                if (mounted) {
                    getInterface().window.ready();
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    const answer = useCallback((use: boolean) => {
        getInterface().window.closeWith<WindowAppType.ServerSessionPrompt>({ use });
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                getInterface().window.closeWith<WindowAppType.ServerSessionPrompt>(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <AppLayout
            title={t("serverSession.window")}
            initialControlAbility={SERVER_SESSION_WINDOW_CONTROL_ABILITY}
            windowControlPolicy={WindowControlPolicy.None}
        >
            <div className="flex h-full min-h-0 flex-col bg-surface text-fg" data-server-session-prompt>
                {!prompt && !error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-label={t("common.loading")} />
                    </div>
                ) : null}

                {prompt ? (
                    <>
                        <div className="border-b border-edge bg-surface-sunken px-4 py-2">
                            <div className="text-sm font-medium text-fg">{t("serverSession.title")}</div>
                        </div>

                        {/*
                          * The trust window's structure, for its reason: the identities are boxed so
                          * the paths and addresses can be as legible as they need to be without
                          * reading as prose, and outside the box there are two tones - the state
                          * muted, the consequence not.
                          *
                          * Two boxes rather than one, because they answer two questions the author
                          * checks separately: which project is asking, and which account it would
                          * act as, where.
                          */}
                        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2" data-server-session-project>
                                <div className="truncate text-sm font-medium text-fg">{prompt.projectName}</div>
                                <div className="mt-1 break-all text-2xs leading-4 text-fg-muted">
                                    {prompt.projectPath}
                                </div>
                            </div>
                            <div className="mt-2 rounded-md border border-edge bg-fill-subtle px-3 py-2" data-server-session-account>
                                <div className="truncate text-sm font-medium text-fg">{prompt.serverName}</div>
                                {prompt.serverName !== prompt.serverHost ? (
                                    <div className="mt-1 truncate text-2xs leading-4 text-fg-muted">{prompt.serverHost}</div>
                                ) : null}
                                <div className="mt-1 truncate text-2xs leading-4 text-fg-subtle" data-tip={prompt.accountDetail}>
                                    {t("serverSession.signedInAs", { name: prompt.accountName })}
                                </div>
                            </div>

                            <p className="mt-3 text-xs leading-5 text-fg-muted">{t("serverSession.unused")}</p>
                            <p className="mt-2 text-xs font-medium leading-5 text-fg">
                                {t("serverSession.meaning", { name: prompt.accountName })}
                            </p>
                            <p className="mt-3 text-2xs leading-4 text-fg-subtle">{t("serverSession.later")}</p>
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
                {prompt || error ? (
                    <div className="grid grid-cols-2 gap-2 border-t border-edge bg-surface-sunken p-3">
                        <Button
                            variant="secondary"
                            size="md"
                            autoFocus
                            data-server-session-answer="no"
                            onClick={() => answer(false)}
                        >
                            {t("serverSession.cancel")}
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            disabled={!prompt}
                            data-server-session-answer="yes"
                            onClick={() => answer(true)}
                        >
                            {t("serverSession.confirm")}
                        </Button>
                    </div>
                ) : null}
            </div>
        </AppLayout>
    );
}

export default ServerSessionApp;
