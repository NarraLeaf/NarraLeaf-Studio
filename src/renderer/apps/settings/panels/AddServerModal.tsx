import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import {
    FieldLabel,
    Input,
    Modal,
    dialogFooterButtonClass,
} from "@/lib/components/elements";
import { serverDisplayName, serverHost } from "@/lib/vcs/servers";
import type {
    VcsServerAuthority,
    VcsServerDiscovery,
    VcsServerSession,
    VcsSignInProblem,
} from "@shared/types/vcs";
import type { TranslationKey } from "@shared/i18n";

/**
 * The sentence for each way a token can be refused.
 *
 * The backend reports four unrelated transport failures with one string, so the reason
 * arrives as a code and becomes a sentence here. Two of the codes name an address the
 * sign-in was missing; neither can be answered on this path, because both addresses come
 * from the discovery document rather than from anybody's memory.
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

/**
 * Whether to trust the authority a machine presented, answered somewhere else.
 *
 * Trusting one changes what this installation believes about every connection it makes
 * afterwards, so it is decided in front of the certificate rather than beside an address
 * field. This reads `getInterface().app.promptServerTrust` once the window that asks it
 * is on the interface; the lookup stays a lookup so that an address whose authority is
 * unknown is refused, rather than quietly accepted, wherever that window is absent.
 */
async function askToTrust(address: string, authority: VcsServerAuthority): Promise<boolean> {
    const answer = await getInterface().app
        .promptServerTrust({ address, authority })
        .catch(() => null);
    // Anything other than a window that came back saying yes is a no. A call that failed,
    // a window that was closed, a refusal: none of them is permission, and the difference
    // between them is not something the author is waiting to be told.
    return answer?.success === true && answer.data.trusted;
}

/**
 * How far adding a server has got.
 *
 * The address is held outside this, because a failed probe leaves the field holding what
 * was typed: an address that did not answer is usually one character away from one that
 * does.
 */
type Stage =
    /** Nothing has been reached yet. */
    | { kind: "address" }
    /** Reached, and it wants to know who this is. */
    | { kind: "identity"; address: string; discovery: VcsServerDiscovery }
    /** Reached, and it does not. There is no account to store, so this is the end. */
    | { kind: "no-account"; discovery: VcsServerDiscovery }
    /**
     * Stored. What was joined, and as whom.
     *
     * `projects` is null until the server says, and stays null when it will not: a count
     * nobody answered is nothing to say, never a zero.
     */
    | { kind: "joined"; session: VcsServerSession; projects: number | null };

export interface AddServerModalProps {
    /** Left, by any route: the close button, Escape, the backdrop, or the last step. */
    onClose: () => void;
    /**
     * A server was stored. Raised once, from the call that stored it, and NOT the same
     * event as leaving: the dialog stays open on its last step afterwards, so a list
     * behind it reads again while the reader is still looking at what they joined.
     */
    onAdded?: (session: VcsServerSession) => void;
}

/**
 * Adding a server, as a sequence rather than a form.
 *
 * **Open it by mounting it.** There is no `isOpen`: a caller renders it while it means
 * to show it, which is what leaves a second reading of the sequence starting at the
 * first step rather than wherever the first one stopped.
 *
 * An author is handed one address and nothing else. Everything a sign-in needs - where a
 * token is presented, which remote the repositories live on, whether an account is wanted
 * at all - is behind that address, so the address is asked first and answers the rest. The
 * `lore://` remote among those answers is stored and never shown: it is a fact about the
 * storage that deployment happens to run, and nobody chose it.
 *
 * Nothing is written until `addServer` succeeds. The probe only reads and `addServer` is
 * the one call that stores, so leaving at any point before it leaves this installation
 * exactly as it was.
 *
 * It ends by saying what was joined rather than by closing. Pasting a credential and
 * joining a team are the same keystroke otherwise, and only one of them is what the
 * reader came to do.
 */
export function AddServerModal({ onClose, onAdded }: AddServerModalProps) {
    const { t, tn } = useTranslation();
    const [stage, setStage] = useState<Stage>({ kind: "address" });
    const [address, setAddress] = useState("");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<TranslationKey | null>(null);
    // The project count lands after its step is already drawn, and the dialog can be gone
    // by then - it is the one answer nothing waits for.
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    /**
     * Ask the server what it holds, once it is stored.
     *
     * A refusal is nothing to say rather than a problem to report: the server has been
     * joined either way, and a sentence about a count nobody asked for would be the only
     * red text on a step that succeeded.
     */
    const countProjects = useCallback(async (remoteOrigin: string) => {
        const result = await getInterface().vcs.listServerProjects(remoteOrigin).catch(() => null);
        if (!alive.current || !result?.success || !result.data.ok) return;
        const projects = result.data.projects.length;
        setStage(current => (current.kind === "joined" ? { ...current, projects } : current));
    }, []);

    const reachAddress = useCallback(async () => {
        const target = address.trim();
        if (!target || busy) return;
        setBusy(true);
        setError(null);
        // Two passes at most, and the second only after the authority was accepted:
        // trusting it changes what this machine believes, and the probe is what reads
        // that belief. A second `untrusted` is an answer rather than a reason to ask again.
        for (let pass = 0; pass < 2; pass += 1) {
            const result = await getInterface().vcs.probeServer(target).catch(() => null);
            if (!result?.success) {
                setError("settings.servers.probe.failed");
                break;
            }
            const probe = result.data;
            if (probe.kind === "unreachable") {
                setError("settings.servers.probe.unreachable");
                break;
            }
            if (probe.kind === "not-a-server") {
                setError("settings.servers.probe.notAServer");
                break;
            }
            if (probe.kind === "untrusted") {
                // Asked once. A second refusal on the same address is an answer, not a
                // question to put again.
                const trusted = pass === 0 && await askToTrust(probe.address, probe.authority);
                if (!trusted) {
                    setError("settings.servers.probe.untrusted");
                    break;
                }
                continue;
            }
            setStage(probe.discovery.auth.required
                ? { kind: "identity", address: probe.address, discovery: probe.discovery }
                : { kind: "no-account", discovery: probe.discovery });
            break;
        }
        setBusy(false);
    }, [address, busy]);

    /**
     * The one call that writes anything.
     *
     * What the server said about itself travels with the token, from the answer this
     * dialog already has. Reaching the address again for a name would be a second answer
     * to a question that was put a moment ago, and the sentence above the fields would
     * then be describing a different reading.
     */
    const storeServer = useCallback(async (discovery: VcsServerDiscovery, secret: string) => {
        const result = await getInterface().vcs
            .addServer(discovery.auth.url, discovery.data.url, secret, {
                name: discovery.name,
                version: discovery.version,
                capabilities: discovery.capabilities,
            })
            .catch(() => null);
        if (!result?.success) {
            setError("settings.servers.problems.unknown");
            return;
        }
        if (!result.data.ok) {
            setError(PROBLEM_KEYS[result.data.problem.kind]);
            return;
        }
        // The token is not kept for a moment longer than the call that used it. A box still
        // holding a credential is one a screenshot or the next person at this desk can read.
        setToken("");
        const { session } = result.data;
        setStage({ kind: "joined", session, projects: null });
        onAdded?.(session);
        void countProjects(session.remoteOrigin);
    }, [countProjects, onAdded]);

    const addWithToken = useCallback(async () => {
        if (stage.kind !== "identity" || !token.trim() || busy) return;
        setBusy(true);
        setError(null);
        await storeServer(stage.discovery, token.trim());
        setBusy(false);
    }, [busy, stage, storeServer, token]);

    const submitOnEnter = (run: () => Promise<void>) => (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void run();
        }
    };

    const sentence = error && (
        <p data-servers-seam="problem" className="break-words text-xs text-danger">{t(error)}</p>
    );

    const leaveButton = (
        <button
            type="button"
            data-servers-seam="cancel"
            onClick={onClose}
            className={dialogFooterButtonClass({ variant: "secondary" })}
        >
            {t("settings.servers.cancel")}
        </button>
    );

    const doneButton = (
        <button
            type="button"
            data-servers-seam="submit"
            onClick={onClose}
            className={dialogFooterButtonClass({ variant: "primary" })}
        >
            {t("settings.servers.done")}
        </button>
    );

    function submitButton(label: TranslationKey, ready: boolean, run: () => Promise<void>) {
        return (
            <button
                type="button"
                data-servers-seam="submit"
                disabled={!ready}
                onClick={() => void run()}
                className={dialogFooterButtonClass({ variant: "primary", disabled: !ready })}
            >
                {t(label)}
            </button>
        );
    }

    function body() {
        if (stage.kind === "joined") {
            const name = serverDisplayName(stage.session);
            const host = serverHost(stage.session.remoteOrigin);
            return (
                <div data-servers-seam="wizard-joined" className="flex flex-col gap-1">
                    <p className="text-sm text-fg">{name}</p>
                    {/* Not printed twice: a server that gave no name already reads as its
                        address on the line above. */}
                    {name !== host && <p className="text-2xs text-fg-subtle">{host}</p>}
                    <p className="mt-2 text-xs text-fg-muted">
                        {t("settings.servers.joined.signedInAs", {
                            name: stage.session.account.displayName,
                        })}
                    </p>
                    {stage.projects !== null && (
                        <p data-servers-seam="joined-projects" className="text-xs text-fg-muted">
                            {tn("settings.servers.joined.projects", stage.projects)}
                        </p>
                    )}
                </div>
            );
        }

        if (stage.kind === "no-account") {
            return (
                <div data-servers-seam="wizard-done">
                    <p className="text-xs text-fg-muted">
                        {t("settings.servers.noAccount", { name: stage.discovery.name })}
                    </p>
                </div>
            );
        }

        if (stage.kind === "identity") {
            return (
                <div data-servers-seam="wizard-step-2" className="flex flex-col gap-3">
                    <p className="text-xs text-fg-muted">
                        {t("settings.servers.reached", {
                            name: stage.discovery.name,
                            address: stage.address,
                        })}
                    </p>
                    <div data-servers-seam="identity-token" className="flex flex-col gap-2">
                        <div>
                            {/* Named on the control rather than through `htmlFor`: `FieldLabel`
                                is the shared eyebrow and carries no `for`, so the accessible
                                name goes where it can be relied on. */}
                            <FieldLabel as="div">{t("settings.servers.tokenLabel")}</FieldLabel>
                            <Input
                                data-servers-seam="field-token"
                                aria-label={t("settings.servers.tokenLabel")}
                                fullWidth
                                autoFocus
                                spellCheck={false}
                                value={token}
                                onChange={event => setToken(event.target.value)}
                                onKeyDown={submitOnEnter(addWithToken)}
                                disabled={busy}
                                placeholder={t("settings.servers.tokenPlaceholder")}
                            />
                        </div>
                        <p className="text-xs text-fg-subtle">{t("settings.servers.hint")}</p>
                    </div>
                    {sentence}
                </div>
            );
        }

        return (
            <div data-servers-seam="wizard-step-1" className="flex flex-col gap-3">
                <div>
                    <FieldLabel as="div">{t("settings.servers.addressLabel")}</FieldLabel>
                    <Input
                        data-servers-seam="field-address"
                        aria-label={t("settings.servers.addressLabel")}
                        fullWidth
                        autoFocus
                        spellCheck={false}
                        value={address}
                        onChange={event => setAddress(event.target.value)}
                        onKeyDown={submitOnEnter(reachAddress)}
                        disabled={busy}
                        placeholder={t("settings.servers.addressPlaceholder")}
                    />
                </div>
                {sentence}
            </div>
        );
    }

    function footer() {
        if (stage.kind === "joined" || stage.kind === "no-account") {
            return doneButton;
        }
        if (stage.kind === "identity") {
            return (
                <>
                    {leaveButton}
                    {submitButton(
                        busy ? "settings.servers.adding" : "settings.servers.add",
                        !busy && token.trim().length > 0,
                        addWithToken,
                    )}
                </>
            );
        }
        return (
            <>
                {leaveButton}
                {submitButton(
                    busy ? "settings.servers.checking" : "settings.servers.continue",
                    !busy && address.trim().length > 0,
                    reachAddress,
                )}
            </>
        );
    }

    return (
        <Modal isOpen onClose={onClose} title={t("settings.servers.openAdd")} size="sm" footer={footer()}>
            {body()}
        </Modal>
    );
}
