import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Button, Input } from "@/lib/components/elements";
import type { VcsServerSession, VcsSignInProblem } from "@shared/types/vcs";
import type { TranslationKey } from "@shared/i18n";

/**
 * The sentence for each way a token can be refused.
 *
 * The backend reports four unrelated transport failures with one string, so the reason
 * arrives as a code and becomes a sentence here. Two of the codes name a field this panel
 * then shows: `address` means the token does not say where to sign in, and `server` means
 * it does not say which server it is for.
 */
const PROBLEM_KEYS: Record<VcsSignInProblem["kind"], TranslationKey> = {
    scheme: "settings.servers.problems.scheme",
    token: "settings.servers.problems.token",
    address: "settings.servers.problems.address",
    server: "settings.servers.problems.server",
    certificate: "settings.servers.problems.certificate",
    unreachable: "settings.servers.problems.unreachable",
    refused: "settings.servers.problems.refused",
    unknown: "settings.servers.problems.unknown",
};

/** The host and port, which is what identifies a server to the person who was given it. */
function serverAddress(session: VcsServerSession): string {
    return session.remoteOrigin.replace(/^lore:\/\//i, "");
}

/**
 * Every server this installation is signed in to, and the way to add one.
 *
 * **A server is added here and nowhere else.** It is signed in to once and then serves
 * every project pointed at it, so it belongs to the machine; a project chooses from this
 * list rather than carrying an account of its own. That is the whole reason this panel
 * exists, and why the version rail sends people here instead of asking for a token in a
 * side panel.
 *
 * Adding one is a single field. A token names, in its own audience, the endpoint that
 * issued it and the server it is good for, so pasting it is enough; the two address
 * fields appear only after the answer says this token names neither, which is what a
 * plain `loreserver` mints.
 */
export function ServersPanel() {
    const { t } = useTranslation();
    const [servers, setServers] = useState<VcsServerSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [token, setToken] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [remoteUrl, setRemoteUrl] = useState("");
    const [problem, setProblem] = useState<VcsSignInProblem | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const result = await getInterface().vcs.listServers().catch(() => null);
        setServers(result?.success ? result.data.servers : []);
        setLoading(false);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const close = useCallback(() => {
        setAdding(false);
        // The token is not kept for a moment longer than the call that used it. A box still
        // holding a credential is one a screenshot or the next person at this desk can read.
        setToken("");
        setAuthUrl("");
        setRemoteUrl("");
        setProblem(null);
    }, []);

    const add = useCallback(async () => {
        if (!token.trim() || busy) return;
        setBusy(true);
        setProblem(null);
        const result = await getInterface().vcs
            .addServer(authUrl.trim(), remoteUrl.trim(), token.trim())
            .catch(() => null);
        setBusy(false);
        if (!result?.success) {
            setProblem({ kind: "unknown", detail: "" });
            return;
        }
        if (!result.data.ok) {
            setProblem(result.data.problem);
            return;
        }
        setServers(result.data.servers);
        close();
    }, [authUrl, busy, close, remoteUrl, token]);

    const forget = useCallback(async (session: VcsServerSession) => {
        setBusy(true);
        const result = await getInterface().vcs.forgetServer(session.remoteOrigin).catch(() => null);
        setBusy(false);
        if (result?.success) setServers(result.data.servers);
    }, []);

    // Both read off the last answer rather than held as state, so a field cannot disagree
    // with the sentence shown under it.
    const needsAuthUrl = problem?.kind === "address";
    const needsRemoteUrl = problem?.kind === "server";

    return (
        <div className="flex flex-col gap-2">
            {!loading && servers.length === 0 && !adding && (
                <p className="text-xs text-fg-subtle">{t("settings.servers.empty")}</p>
            )}

            {servers.length > 0 && (
                <div className="flex flex-col gap-1">
                    {servers.map(session => (
                        <div
                            key={session.remoteOrigin}
                            data-servers-row={session.remoteOrigin}
                            className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-fill-subtle"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-fg-muted" data-tip={session.authUrl}>
                                    {serverAddress(session)}
                                </p>
                            </div>
                            <span className="shrink-0 text-xs text-fg-subtle" data-tip={session.account.identity}>
                                {session.account.displayName}
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 shrink-0"
                                disabled={busy}
                                onClick={() => void forget(session)}
                            >
                                {t("settings.servers.signOut")}
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {adding ? (
                <div data-servers-seam="add-form" className="flex flex-col gap-2">
                    <div>
                        <label className="block text-xs text-fg-subtle">
                            {t("settings.servers.tokenLabel")}
                        </label>
                        <Input
                            size="sm"
                            autoFocus
                            value={token}
                            onChange={event => setToken(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void add();
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    close();
                                }
                            }}
                            disabled={busy}
                            placeholder={t("settings.servers.tokenPlaceholder")}
                            className="mt-1"
                        />
                    </div>
                    {needsAuthUrl && (
                        <div>
                            <label className="block text-xs text-fg-subtle">
                                {t("settings.servers.authUrlLabel")}
                            </label>
                            <Input
                                size="sm"
                                value={authUrl}
                                onChange={event => setAuthUrl(event.target.value)}
                                disabled={busy}
                                placeholder={t("settings.servers.authUrlPlaceholder")}
                                className="mt-1"
                            />
                        </div>
                    )}
                    {needsRemoteUrl && (
                        <div>
                            <label className="block text-xs text-fg-subtle">
                                {t("settings.servers.remoteUrlLabel")}
                            </label>
                            <Input
                                size="sm"
                                value={remoteUrl}
                                onChange={event => setRemoteUrl(event.target.value)}
                                disabled={busy}
                                placeholder={t("settings.servers.remoteUrlPlaceholder")}
                                className="mt-1"
                            />
                        </div>
                    )}
                    {problem && (
                        <p data-servers-seam="problem" className="break-words text-xs text-danger">
                            {t(PROBLEM_KEYS[problem.kind])}
                        </p>
                    )}
                    <p className="text-xs text-fg-subtle">{t("settings.servers.hint")}</p>
                    <div className="flex items-center gap-2">
                        <Button size="sm" className="h-7" disabled={busy || !token.trim()} onClick={() => void add()}>
                            {t(busy ? "settings.servers.adding" : "settings.servers.add")}
                        </Button>
                        <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={close}>
                            {t("settings.servers.cancel")}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="h-7" onClick={() => setAdding(true)}>
                        {t("settings.servers.openAdd")}
                    </Button>
                </div>
            )}
        </div>
    );
}
