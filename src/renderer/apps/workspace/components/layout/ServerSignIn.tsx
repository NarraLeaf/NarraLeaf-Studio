import { useState } from "react";
import { Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import type { VcsServerAuthority, VcsServerReach, VcsSignInProblem } from "@shared/types/vcs";
import { vcsAuthorityIsVouchedFor } from "@shared/types/vcs";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Input } from "@/lib/components/elements/Input";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { IconButton } from "@/lib/components/elements/Button";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * Presenting a credential to the server a project is pointed at, and saying who is signed in.
 *
 * **This lives with the Team panel rather than in the version rail.** A token is a machine-wide
 * credential and signing in is done a handful of times a year; the rail is a column pressed every
 * working day to move versions. Two credential boxes standing above Send and Get displaced the two
 * controls the panel exists for. The panel in the status bar is where a server and an account are
 * settled, and this is the form it opens.
 */

/**
 * Signing in to the server this project is pointed at, and saying who is signed in.
 *
 * **The whole point of it is on the last line**: while a session is in force, what goes on a
 * revision is the name the server knows this account by, not what somebody typed into their own
 * settings - so the panel says that name, where it came from, and nothing else.
 *
 * The refusal sentences are not decoration either. The backend answers an untrusted certificate,
 * a port nothing listens on, an unresolvable name and an endpoint speaking plain HTTP with one
 * identical sentence, so the reason arrives here as a code and this is where it becomes something
 * a person can act on. The certificate case is the one worth reading twice: nothing inside Studio
 * can trust an authority on this machine's behalf, so it names the fingerprint to compare and
 * sends them to the person who runs the server.
 */
export function SignInSection({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const { serverSession, signIn, busy } = surface;
    const [open, setOpen] = useState(false);
    const [address, setAddress] = useState("");
    const [token, setToken] = useState("");
    const running = busy !== null;
    // Both read off the last answer rather than held as state, so they cannot disagree
    // with the sentence being shown underneath the fields.
    const needsAddress = signIn !== null && !signIn.ok && signIn.problem.kind === "address";
    const untrusted = signIn !== null && !signIn.ok && signIn.problem.kind === "certificate"
        ? signIn.problem.authority
        : null;
    // A token that named a DIFFERENT authority than the one answering gets no button at
    // all - not a quieter one. The sentence above says something is standing in the way,
    // and a control underneath offering to trust it anyway argues with that sentence.
    const offer = untrusted && (vcsAuthorityIsVouchedFor(untrusted) || untrusted.expected === "")
        ? untrusted
        : null;

    if (serverSession) {
        return (
            <div data-vcs-seam="server-identity" className="mt-1 flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted" data-tip={serverSession.account.identity}>
                    {t("workspace.shell.versionControl.server.signIn.signedInAs", {
                        name: serverSession.account.displayName,
                    })}
                </span>
                <button
                    type="button"
                    onClick={() => void surface.signOutOfServer()}
                    disabled={running}
                    className="shrink-0 text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
                >
                    {t("workspace.shell.versionControl.server.signIn.signOut")}
                </button>
            </div>
        );
    }

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={running}
                className="mt-1 flex items-center gap-1.5 text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
            >
                <KeyRound className="h-3 w-3" />
                {t("workspace.shell.versionControl.server.signIn.open")}
            </button>
        );
    }

    const submit = () => {
        if (!token.trim()) return;
        void surface.signInToServer(address.trim(), token.trim()).then(signedIn => {
            if (!signedIn) return;
            setOpen(false);
            // The token is not kept for a moment longer than the call that used it. Nothing
            // here needs it again, and a box still holding a credential is one a screenshot,
            // a screen share or the next person at this desk can read.
            setToken("");
        });
    };

    return (
        <div data-vcs-seam="sign-in-form" className="mt-2">
            <label className="block text-2xs tracking-wide text-fg-subtle">
                {t("workspace.shell.versionControl.server.signIn.tokenLabel")}
            </label>
            <Input
                size="sm"
                autoFocus
                value={token}
                onChange={event => setToken(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        setOpen(false);
                    }
                }}
                disabled={running}
                placeholder={t("workspace.shell.versionControl.server.signIn.tokenPlaceholder")}
                className="mt-1 text-2xs"
            />
            {/* Only once a sign-in has come back saying the token names nowhere. A Team server's
                token carries its own endpoint, so for most people this box never appears;
                putting it above the token box, as this form used to, asked everybody for
                an address most of them had no way to know. */}
            {needsAddress && (
                <>
                    <label className="mt-2 block text-2xs tracking-wide text-fg-subtle">
                        {t("workspace.shell.versionControl.server.signIn.addressLabel")}
                    </label>
                    <Input
                        size="sm"
                        autoFocus
                        value={address}
                        onChange={event => setAddress(event.target.value)}
                        disabled={running}
                        placeholder={t("workspace.shell.versionControl.server.signIn.addressPlaceholder")}
                        className="mt-1 text-2xs"
                    />
                </>
            )}
            <p className="mt-1 text-2xs text-fg-subtle">
                {t("workspace.shell.versionControl.server.signIn.hint")}
            </p>
            {/* `break-words` earns its place on exactly one of these sentences: the ones about
                certificates end in a 95-character fingerprint with no spaces in it, and a rail
                320px wide cuts it off two thirds of the way through - which leaves the author
                comparing a fingerprint against half of one. Ordinary prose is unaffected; only a
                word that cannot fit at all is broken. */}
            {signIn && !signIn.ok && describeSignInProblem(signIn.problem, t) !== "" && (
                <p data-vcs-seam="sign-in-problem" className="mt-1.5 break-words text-2xs text-danger">
                    {describeSignInProblem(signIn.problem, t)}
                </p>
            )}
            {offer && (
                <AuthorityOffer
                    authority={offer}
                    surface={surface}
                    onTrusted={() => { void surface.signInToServer(address.trim(), token.trim()); }}
                />
            )}
            <div className="mt-2 flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={submit}
                    disabled={running || !token.trim() || (needsAddress && !address.trim())}
                    className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
                >
                    {busy === "remote"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <KeyRound className="h-3 w-3" />}
                    {t("workspace.shell.versionControl.server.signIn.submit")}
                </button>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={running}
                    className="flex h-7 items-center justify-center rounded-md border border-edge px-2 text-2xs text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {t("workspace.shell.versionControl.server.signIn.cancel")}
                </button>
            </div>
        </div>
    );
}

/**
 * The offer to trust a server's certificate authority, and the dialog that decides it.
 *
 * **What this replaced.** The certificate refusal used to end in a paragraph telling the
 * author to ask whoever runs the server for a command. That command names a certificate
 * file living on the server's own disk, so on the author's machine it could not be run at
 * all - and the people who reach this are, by construction, the ones who do not run the
 * server. The certificate is now on this machine before the question is asked.
 *
 * **Two ways in, and they are not the same question.** Where the pasted token names this
 * authority, the comparison has already been made and what is left is a decision. Where
 * it names none - a plain loreserver, an older Team server - the fingerprint is shown and the
 * author is asked to check it against what they were told, exactly as before. A token
 * that names a DIFFERENT authority never reaches here: that is the shape an interception
 * has, and the rail says so instead of offering a button.
 */
function AuthorityOffer({ authority, surface, onTrusted }: {
    authority: VcsServerAuthority;
    surface: VersionSurface;
    onTrusted: () => void;
}) {
    const { t } = useTranslation();
    const [asking, setAsking] = useState(false);
    const vouched = vcsAuthorityIsVouchedFor(authority);
    const key = "workspace.shell.versionControl.server.signIn.trust" as const;

    const confirm = () => {
        void surface.trustAuthority(authority.path).then(installed => {
            setAsking(false);
            // Only on success, and from the rail rather than from the surface: whether to
            // try again is a question about what is still in the token box up there.
            if (installed) onTrusted();
        });
    };

    return (
        <div data-vcs-seam="authority-offer" className="mt-1.5">
            <button
                type="button"
                onClick={() => setAsking(true)}
                disabled={surface.busy !== null}
                className={cn(
                    "flex h-7 w-full items-center justify-center gap-1.5 rounded-md px-2 text-2xs",
                    "transition-colors cursor-default disabled:opacity-50",
                    // Filled only where the token already vouched for this authority.
                    // Where it did not, the author still has a comparison to make, and a
                    // filled button in front of an unmade decision argues for pressing it.
                    vouched
                        ? "bg-primary text-on-primary hover:opacity-90"
                        : "border border-edge text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                <ShieldCheck className="h-3 w-3" />
                {t(`${key}.open`)}
            </button>
            <Modal
                isOpen={asking}
                onClose={() => setAsking(false)}
                title={t(`${key}.title`)}
                size="md"
                footer={(
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setAsking(false)}
                            className={dialogFooterButtonClass({ variant: "secondary" })}
                        >
                            {t(`${key}.cancel`)}
                        </button>
                        {authority.canInstall && (
                            <button
                                type="button"
                                onClick={confirm}
                                disabled={surface.busy !== null}
                                className={dialogFooterButtonClass({
                                    variant: "primary",
                                    disabled: surface.busy !== null,
                                })}
                            >
                                {t(`${key}.confirm`)}
                            </button>
                        )}
                    </div>
                )}
            >
                <div className="space-y-3 text-sm text-fg-muted">
                    <p>{t(vouched ? `${key}.vouched` : `${key}.compare`)}</p>
                    <div className="rounded-md border border-edge bg-fill-subtle p-3">
                        <FieldLabel>{t(`${key}.authorityLabel`)}</FieldLabel>
                        <p className="mt-1 text-sm text-fg">{authority.subject}</p>
                        <FieldLabel className="mt-2 block">{t(`${key}.fingerprintLabel`)}</FieldLabel>
                        {/* Monospaced and broken across lines on purpose: this is the one
                            string in the dialog somebody may read character by character
                            against another screen, and proportional type makes that worse. */}
                        <p className="mt-1 break-all font-mono text-xs text-fg">{authority.fingerprint}</p>
                    </div>
                    {/* Said plainly, and not softened. An authority is not one server's
                        certificate: whatever holds its key can issue a certificate for any
                        name and this account will believe it. */}
                    <p>{t(`${key}.meaning`)}</p>
                    {!authority.canInstall && (
                        <div>
                            <p>{t(`${key}.manual`)}</p>
                            <div className="mt-2 flex items-start gap-2 rounded-md border border-edge bg-fill-subtle p-3">
                                <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg">
                                    {authority.command}
                                </code>
                                <IconButton
                                    size="sm"
                                    aria-label={t(`${key}.copy`)}
                                    onClick={() => void navigator.clipboard?.writeText(authority.command)}
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </IconButton>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
}

/**
 * One sentence per way a sign-in can fail, in the reader's own language.
 *
 * Built here rather than passed through from the backend because the backend cannot tell four
 * of these apart - see {@link SignInSection} - and because the one sentence that has to be acted
 * on by a person, the certificate, names a command that is not Studio's to run.
 */
export function describeSignInProblem(
    problem: VcsSignInProblem,
    t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
    const key = "workspace.shell.versionControl.server.signIn.problem" as const;
    switch (problem.kind) {
        case "scheme":
            return t(`${key}.scheme`);
        case "token":
            return t(`${key}.token`);
        case "address":
            return t(`${key}.address`);
        case "certificate":
            // Vouched for: nothing is wrong that a sentence in red would describe. The
            // offer below the form is the whole of the answer, and a warning above it
            // would be arguing against the button it sits on top of.
            if (vcsAuthorityIsVouchedFor(problem.authority)) return "";
            // The token named an authority and something else answered. Not a variant of
            // "you have not trusted this one yet": both fingerprints are named, and no
            // button is offered anywhere on this path.
            if (problem.authority.expected) {
                return t(`${key}.mismatch`, {
                    expected: problem.authority.expected,
                    found: problem.authority.fingerprint,
                });
            }
            return t(`${key}.certificate`, { fingerprint: problem.authority.fingerprint || "-" });
        case "server":
            // Only answered where a server is added on its own, which happens in Settings.
            // Handled rather than defaulted so that adding a refusal kind keeps failing
            // here loudly instead of reading `detail` off a shape that has none.
            return t("settings.servers.problems.server");
        case "unreachable":
            return t(`${key}.unreachable`, { detail: problem.detail });
        case "refused":
            return t(`${key}.refused`, { detail: problem.detail });
        default:
            return t(`${key}.unknown`, { detail: problem.detail });
    }
}

/** What reaching the server after signing in came to, said as a sentence rather than a number. */
export function describeReach(reach: VcsServerReach): TranslationKey {
    return `workspace.shell.versionControl.server.signIn.reach.${reach}` as TranslationKey;
}
