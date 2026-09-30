import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/lib/components/layout";
import { Button } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { PROJECT_TRUST_ORIGIN_LABEL } from "@/lib/app/projectTrustOriginLabel";
import { useTranslation } from "@/lib/i18n";
import type { ProjectTrustPromptProps } from "@shared/types/projectTrust";
import { WindowAppType, WindowControlPolicy, type WindowControlAbility } from "@shared/types/window";

const PROJECT_TRUST_WINDOW_CONTROL_ABILITY: WindowControlAbility = {
    minimizable: false,
    maximizable: false,
    closable: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
};

/**
 * One question, in a window of its own: is this project trusted?
 *
 * The window holds the project's name, where it is on disk, how Studio met it, what it cannot do
 * until it is trusted and what trusting it means. Nothing else: an author reading this is
 * deciding whether to run somebody else's code, not learning how the ledger works.
 *
 * It is a window rather than a sheet inside the workspace because the workspace renders the
 * project's content, and the answer to this question must come from a surface that content cannot
 * reach. The host reads the answer off this window's close result and writes the grant itself.
 *
 * "Not now" takes the focus. The reachable mistake here is agreeing without meaning to, so the key
 * that is already down when the window appears must not be the one that agrees.
 */
export function ProjectTrustApp() {
    const { t } = useTranslation();
    const [prompt, setPrompt] = useState<ProjectTrustPromptProps | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        getInterface()
            .getWindowProps<WindowAppType.ProjectTrustPrompt>()
            .then(result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setError(result.error ?? t("projectTrust.error.load"));
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
                // Announced either way: the host holds the window hidden until this arrives, and
                // one that never appears because it could not read its own props leaves the
                // caller waiting on an answer nobody can give.
                if (mounted) {
                    getInterface().window.ready();
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    const answer = useCallback((trusted: boolean) => {
        getInterface().window.closeWith<WindowAppType.ProjectTrustPrompt>({ trusted });
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

    return (
        <AppLayout
            title={t("projectTrust.window")}
            initialControlAbility={PROJECT_TRUST_WINDOW_CONTROL_ABILITY}
            windowControlPolicy={WindowControlPolicy.None}
        >
            <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
                {!prompt && !error ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-label={t("common.loading")} />
                    </div>
                ) : null}

                {prompt ? (
                    <>
                        <div className="border-b border-edge bg-surface-sunken px-4 py-2">
                            <div className="text-sm font-medium text-fg">{t("projectTrust.title")}</div>
                        </div>

                        {/*
                          * Two blocks, read in order: which project, then what saying yes does.
                          *
                          * The identity is boxed rather than set in a tone of its own. A path is the
                          * longest run of text here and the least of what the decision turns on, and
                          * shading it down far enough to stop competing would also make the one thing
                          * that identifies the project hard to read. Inside a box it can be as legible
                          * as it likes without reading as prose.
                          *
                          * That leaves the prose two tones and no more: the context is muted, the
                          * consequence is not, and that contrast is the whole hierarchy. The footnote
                          * is `text-2xs`, which makes it a different kind of text rather than a third
                          * shade of paragraph.
                          */}
                        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2">
                                <div className="truncate text-sm font-medium text-fg">{prompt.projectName}</div>
                                <div className="mt-1 break-all text-2xs leading-4 text-fg-muted">
                                    {prompt.projectPath}
                                </div>
                                <div className="mt-1 text-2xs leading-4 text-fg-subtle">
                                    {t(PROJECT_TRUST_ORIGIN_LABEL[prompt.origin])}
                                </div>
                            </div>

                            <p className="mt-3 text-xs leading-5 text-fg-muted">{t("projectTrust.untrusted")}</p>
                            <p className="mt-2 text-xs font-medium leading-5 text-fg">{t("projectTrust.meaning")}</p>
                            <p className="mt-3 text-2xs leading-4 text-fg-subtle">{t("projectTrust.later")}</p>
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
                        <Button variant="secondary" size="md" autoFocus onClick={() => answer(false)}>
                            {t("projectTrust.cancel")}
                        </Button>
                        <Button variant="primary" size="md" disabled={!prompt} onClick={() => answer(true)}>
                            {t("projectTrust.confirm")}
                        </Button>
                    </div>
                ) : null}
            </div>
        </AppLayout>
    );
}

export default ProjectTrustApp;
