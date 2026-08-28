import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { listProjects } from "@/lib/team";
import {
    Button,
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
 * The capability name a server answers with when it accepts a username and a password.
 *
 * Read off `VcsServerDiscovery.capabilities`, which is a list of opaque names kept as
 * they came. Absent from every Team server older than the claim - so the token field is
 * what a reader gets by default, and the password half appears only where the machine on
 * the other end said it would answer.
 */
const PASSWORD_SIGN_IN_CAPABILITY = "password-sign-in";

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
 * Why a username and a password did not become a token.
 *
 * **`refused` is one answer and covers four situations.** A server answers the same
 * `401` to an unknown username, a wrong password, a disabled account and an account
 * that is not a person's - deliberately, because telling the four apart is telling a
 * stranger which usernames exist. The sentence this maps to must not claim to know
 * which of them happened.
 */
export type PasswordSignInProblem =
    /** The server answered, and would not issue a token. */
    | "refused"
    /** Nothing in this installation can carry the request. The default seam's answer. */
    | "unavailable"
    /** Nothing answered at the sign-in address. */
    | "unreachable"
    /** Anything else. */
    | "unknown";

export interface PasswordSignInRequest {
    /** Where a token is minted, from the server's own discovery answer. */
    authUrl: string;
    username: string;
    /**
     * The password, for the duration of this call and no longer.
     *
     * The caller has already cleared it from the field it was typed into by the time
     * this runs, so this string is the only copy. Nothing may store it, log it, or put
     * it in an error it hands back.
     */
    password: string;
}

export type PasswordSignInOutcome =
    | { ok: true; token: string }
    | { ok: false; reason: PasswordSignInProblem };

/**
 * How a username and a password become a token. **The seam this dialog is built around.**
 *
 * A password never reaches the backend from here: the request belongs to the main
 * process, which owns every socket Studio opens, and no route carries it yet. So the
 * dialog states the shape of the call and takes it as a parameter, and connecting the
 * transport is one prop rather than a rewrite of the identity step.
 *
 * A refusal is DATA rather than a thrown error, as every refusal that crosses a Studio
 * boundary is: the reader is told which of four things happened in their own language,
 * which is not something an English string from a server can do.
 */
export type PasswordSignIn = (request: PasswordSignInRequest) => Promise<PasswordSignInOutcome>;

/**
 * What a password sign-in comes to on an installation with nothing to carry it.
 *
 * The default, so the password half is a working, reachable interface everywhere rather
 * than one that is hidden until a transport exists. What a reader gets is the ordinary
 * problem sentence, in the ordinary place, saying this installation cannot do it - and
 * the token beside it, which it can.
 */
export const passwordSignInUnavailable: PasswordSignIn = () =>
    Promise.resolve({ ok: false, reason: "unavailable" });

/** The sentence for each way a password can fail to become a token. */
const PASSWORD_PROBLEM_KEYS: Record<PasswordSignInProblem, TranslationKey> = {
    // One sentence for four refusals, because the server sends one.
    refused: "settings.servers.signInRefused",
    unavailable: "settings.servers.signInUnavailable",
    unreachable: "settings.servers.problems.unreachable",
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
    /** How a password becomes a token. See {@link PasswordSignIn}. */
    signInWithPassword?: PasswordSignIn;
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
 * at all, whether a password will do instead of a token - is behind that address, so the
 * address is asked first and answers the rest. The `lore://` remote among those answers is
 * stored and never shown: it is a fact about the storage that deployment happens to run,
 * and nobody chose it.
 *
 * Nothing is written until `addServer` succeeds. The probe only reads, a password sign-in
 * only mints, and `addServer` is the one call that stores - so leaving at any point before
 * it leaves this installation exactly as it was.
 *
 * It ends by saying what was joined rather than by closing. Pasting a credential and
 * joining a team are the same keystroke otherwise, and only one of them is what the
 * reader came to do.
 */
export function AddServerModal({
    onClose,
    onAdded,
    signInWithPassword = passwordSignInUnavailable,
}: AddServerModalProps) {
    const { t, tn } = useTranslation();
    const [stage, setStage] = useState<Stage>({ kind: "address" });
    const [address, setAddress] = useState("");
    const [token, setToken] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    // Whether the reader asked for the token instead. Only ever consulted where a
    // password is on offer at all, so a server that wants a token needs no answer here.
    const [tokenChosen, setTokenChosen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<TranslationKey | null>(null);
    // The project count lands after its step is already drawn, and the dialog can be gone
    // by then - it is the one answer nothing waits for.
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    const offersPassword = stage.kind === "identity"
        && stage.discovery.capabilities.includes(PASSWORD_SIGN_IN_CAPABILITY);
    const method: "password" | "token" = offersPassword && !tokenChosen ? "password" : "token";

    /**
     * Ask the server what it holds, once it is stored.
     *
     * A refusal is nothing to say rather than a problem to report: the server has been
     * joined either way, and a sentence about a count nobody asked for would be the only
     * red text on a step that succeeded.
     */
    const countProjects = useCallback(async (remoteOrigin: string) => {
        // Asked over the session, which the just-stored server can open: `addServer` has
        // written the record and sealed the token by the time this runs, so the socket has
        // everything it needs. A refusal is still nothing to say - see the note above.
        const result = await listProjects(remoteOrigin);
        if (!alive.current || !result.ok) return;
        // What the server holds rather than how many rows it sent: one answer is bounded,
        // and a deployment past that bound would otherwise be reported at the bound.
        const projects = result.value.total;
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
     * The one call that writes anything, whichever half of the identity step reached it.
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
                policy: discovery.policy,
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

    const addWithPassword = useCallback(async () => {
        if (stage.kind !== "identity" || busy) return;
        const name = username.trim();
        const secret = password;
        if (!name || !secret) return;
        setBusy(true);
        setError(null);
        // Out of state before the call that uses it is even awaited, and typed again after a
        // refusal rather than left sitting in a box. The token field is cleared on the same
        // principle; a password is the one credential a reader can be made to say twice.
        setPassword("");
        const outcome = await signInWithPassword({
            authUrl: stage.discovery.auth.url,
            username: name,
            password: secret,
        }).catch((): PasswordSignInOutcome => ({ ok: false, reason: "unknown" }));
        if (!outcome.ok) {
            setError(PASSWORD_PROBLEM_KEYS[outcome.reason]);
            setBusy(false);
            return;
        }
        await storeServer(stage.discovery, outcome.token);
        setBusy(false);
    }, [busy, password, signInWithPassword, stage, storeServer, username]);

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
                    {method === "password" ? (
                        <div data-servers-seam="identity-password" className="flex flex-col gap-2">
                            <div>
                                {/* Named on the control rather than through `htmlFor`: `FieldLabel`
                                    is the shared eyebrow and carries no `for`, so the accessible
                                    name goes where it can be relied on. */}
                                <FieldLabel as="div">{t("settings.servers.usernameLabel")}</FieldLabel>
                                <Input
                                    data-servers-seam="field-username"
                                    aria-label={t("settings.servers.usernameLabel")}
                                    fullWidth
                                    autoFocus
                                    autoComplete="username"
                                    spellCheck={false}
                                    value={username}
                                    onChange={event => setUsername(event.target.value)}
                                    onKeyDown={submitOnEnter(addWithPassword)}
                                    disabled={busy}
                                />
                            </div>
                            <div>
                                <FieldLabel as="div">{t("settings.servers.passwordLabel")}</FieldLabel>
                                <Input
                                    data-servers-seam="field-password"
                                    aria-label={t("settings.servers.passwordLabel")}
                                    type="password"
                                    fullWidth
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={event => setPassword(event.target.value)}
                                    onKeyDown={submitOnEnter(addWithPassword)}
                                    disabled={busy}
                                />
                            </div>
                        </div>
                    ) : (
                        <div data-servers-seam="identity-token" className="flex flex-col gap-2">
                            <div>
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
                    )}
                    {sentence}
                    {offersPassword && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="-ml-2 self-start"
                            data-servers-seam={method === "password" ? "use-token" : "use-password"}
                            disabled={busy}
                            onClick={() => {
                                // The sentence on screen was about the half being left, and a
                                // password typed into it has no business outliving it.
                                setError(null);
                                setPassword("");
                                setTokenChosen(method === "password");
                            }}
                        >
                            {t(method === "password"
                                ? "settings.servers.useToken"
                                : "settings.servers.usePassword")}
                        </Button>
                    )}
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
        if (stage.kind === "identity" && method === "password") {
            return (
                <>
                    {leaveButton}
                    {submitButton(
                        busy ? "settings.servers.signingIn" : "settings.servers.signIn",
                        !busy && username.trim().length > 0 && password.length > 0,
                        addWithPassword,
                    )}
                </>
            );
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
