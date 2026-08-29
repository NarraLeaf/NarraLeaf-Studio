import { spawn } from "child_process";
import { readdirSync, readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { join } from "path";
import tls from "tls";
import type { VcsServerAuthority } from "@shared/types/vcs";

/**
 * Telling this machine to trust the authority a sign-in endpoint signs with.
 *
 * This is the one thing in Studio that changes a setting belonging to the operating
 * system rather than to a project, and it is here rather than nowhere because of what
 * the alternative costs an author. The client library builds its chain against the
 * host's own trust store: there is no pinning hook, and `SSL_CERT_FILE` is ignored on
 * Windows, so nothing inside the connection can establish trust the first time. Before
 * this module, the remedy printed on screen was to ask the server's operator for a
 * command - a command naming a certificate file that exists only on the server, which
 * is to say a remedy that could not be carried out.
 *
 * **What the author is actually deciding.** An authority is not one server's
 * certificate: anything holding its private key can issue a certificate for any name,
 * and this account will believe it. That is why nothing here runs without a press, why
 * the current user's store is used rather than the machine's - so a mistake costs one
 * account rather than every account on the computer - and why the interface names the
 * server, the authority and its fingerprint before offering the button.
 *
 * Each platform differs in kind, not only in spelling:
 *
 *   - Windows has a per-user `Root` store and `certutil` writes to it, silently on
 *     Windows 11. The operating system may still raise its own confirmation, which is
 *     why {@link authorityInstallPlan} says so.
 *   - macOS has the login keychain; `security` writes to it and asks for the account
 *     password in a window of its own.
 *   - Linux has no per-user store that other programs' TLS stacks read. What exists is
 *     a machine-wide directory needing root, so nothing is run and the commands are
 *     printed instead. The certificate is still written to this machine, which is the
 *     half that was previously impossible.
 */

/** How this platform is asked to trust a certificate. */
export interface AuthorityInstallPlan {
    /** Whether Studio can carry it out, or can only say what to run. */
    canInstall: boolean;
    /** The command, as a person would type it. */
    command: string;
    /** The program and its arguments, for the platforms it runs on. */
    argv: readonly string[];
}

/** The file name the certificate is copied to where a path has to be typed. */
const LINUX_FILE_NAME = "narraleaf-server.crt";

/** How long a written certificate is kept. Anything older is swept on the next write. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Quote a path for the shell the command will be pasted into.
 *
 * Windows paths hold spaces and backslashes and go into `cmd`, which wants double
 * quotes; a POSIX shell wants single ones.
 */
function quote(target: string): string {
    if (process.platform === "win32") {
        return target.includes(" ") ? `"${target}"` : target;
    }
    return /^[A-Za-z0-9_@%+=:,./-]+$/.test(target) ? target : `'${target.replaceAll("'", `'\\''`)}'`;
}

/** What this platform does about a certificate at `certificatePath`. */
export function authorityInstallPlan(certificatePath: string): AuthorityInstallPlan {
    switch (process.platform) {
        case "win32":
            // `-user` is the whole of the difference between this and an installation
            // every account on the machine inherits. `Root` is the store a chain is
            // built to; anywhere else installs a certificate trusted for nothing.
            return {
                canInstall: true,
                command: `certutil -user -addstore Root ${quote(certificatePath)}`,
                argv: ["certutil", "-user", "-addstore", "Root", certificatePath],
            };
        case "darwin":
            // Without `-d` this is the login keychain, which is the current user's.
            // `-r trustRoot` is what makes it a trusted root rather than a certificate
            // the system merely holds a copy of.
            return {
                canInstall: true,
                command: `security add-trusted-cert -r trustRoot ${quote(certificatePath)}`,
                argv: ["security", "add-trusted-cert", "-r", "trustRoot", certificatePath],
            };
        default:
            // Linux and anything else. The per-user NSS database Firefox and Chrome
            // read is not what other programs use, so a certificate installed there
            // would be trusted by browsers and by nothing else.
            return {
                canInstall: false,
                command:
                    `sudo cp ${quote(certificatePath)} /usr/local/share/ca-certificates/${LINUX_FILE_NAME}`
                    + " && sudo update-ca-certificates",
                argv: [],
            };
    }
}

/** Where written certificates live, under Studio's own data directory. */
export function authorityDirectory(userDataDir: string): string {
    return path.join(userDataDir, "vcs-authorities");
}

/**
 * Where the authorities somebody has actually accepted are kept.
 *
 * Separate from the directory above, and the separation is the point rather than tidiness.
 * That one holds every authority a probe has ever met, because the prompt has to name a
 * file on disk before anybody has answered anything. This one holds the ones an author
 * said yes to, which is a smaller set and the only one anything here may build a chain
 * against: an authority that was offered and refused must be trusted by nothing.
 */
export function acceptedDirectory(userDataDir: string): string {
    return path.join(authorityDirectory(userDataDir), "accepted");
}

/**
 * Write a certificate where a command can name it, and answer with that path.
 *
 * Named by fingerprint, so writing the same authority twice is one file rather than a
 * growing pile, and so the file a command names cannot be a different certificate from
 * the one whose fingerprint was compared on screen.
 *
 * This is a public certificate and nothing here is secret. It is written under Studio's
 * own directory rather than a temporary one because on Linux the command is run later,
 * by hand, possibly after a restart.
 */
export async function writeAuthorityCertificate(
    userDataDir: string,
    fingerprint: string,
    pem: string,
): Promise<string> {
    const directory = authorityDirectory(userDataDir);
    await fs.mkdir(directory, { recursive: true });
    await sweep(directory);
    const target = path.join(directory, `${fingerprint.replaceAll(":", "").toLowerCase()}.crt`);
    await fs.writeFile(target, pem, "utf-8");
    return target;
}

/**
 * Forget certificates nobody came back for.
 *
 * These are written on a failed sign-in, and most failed sign-ins are followed either by
 * an install or by giving up. Neither leaves anything worth keeping for a month, and
 * failures never stop arriving, so something has to sweep. Deleting a file whose
 * authority IS trusted costs nothing: an accepted one has a copy of its own under
 * `accepted/`, which this does not reach - it lists one directory and skips what is not
 * a certificate in it.
 */
async function sweep(directory: string): Promise<void> {
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    const cutoff = Date.now() - KEEP_MS;
    await Promise.all(
        entries.map(async (entry) => {
            if (!entry.endsWith(".crt")) return;
            const target = path.join(directory, entry);
            const stat = await fs.stat(target).catch(() => null);
            if (stat && stat.mtimeMs < cutoff) await fs.rm(target, { force: true });
        }),
    );
}

/**
 * Keep a copy of an authority the author has just accepted.
 *
 * Called once the install command has succeeded, which is the only moment the answer is
 * known: the file written before the prompt says which authority was offered, and says
 * nothing about what was decided about it.
 *
 * The copy is what makes the decision take effect now rather than at the next start.
 * Node reads the platform's trust store once per process and memoises it, so the
 * authority the operating system has just been told about is invisible to this process
 * until Studio is restarted - and the probe that runs a moment later would go on
 * answering `untrusted` to somebody who had just pressed the button.
 */
export async function rememberAcceptedAuthority(
    userDataDir: string,
    certificatePath: string,
): Promise<void> {
    const directory = acceptedDirectory(userDataDir);
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(certificatePath, path.join(directory, path.basename(certificatePath)));
}

/** What an install command came to. */
export interface AuthorityInstallOutcome {
    installed: boolean;
    /** What the command printed, both streams, for a failure that has to be shown. */
    output: string;
}

/**
 * Run the platform's install command and say whether it took.
 *
 * The output of both streams is kept because the interesting failures say something
 * specific - a policy that forbids adding roots, a keychain the user declined to unlock -
 * and a bare exit code would leave the author with "it did not work".
 *
 * Nothing is retried and nothing is escalated. A refusal here is an answer.
 */
export async function runAuthorityInstall(plan: AuthorityInstallPlan): Promise<AuthorityInstallOutcome> {
    if (!plan.canInstall || plan.argv.length === 0) {
        return { installed: false, output: "" };
    }
    const [command, ...args] = plan.argv;
    return await new Promise<AuthorityInstallOutcome>((resolve) => {
        let output = "";
        // `shell: false`: every argument here is passed as one, so a certificate path
        // holding a space or an ampersand is a path rather than something the shell
        // takes apart. The printed command is quoted for a human; this one is not a
        // string at all.
        const child = spawn(command, args, { windowsHide: true, shell: false });
        child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf-8"); });
        child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf-8"); });
        child.on("error", (error: Error) => {
            resolve({ installed: false, output: `${output}${error.message}`.trim() });
        });
        child.on("close", (code: number | null) => {
            resolve({ installed: code === 0, output: output.trim() });
        });
    });
}

/**
 * Describe an authority for the interface: what it is, and what can be done here.
 *
 * `expected` is what the pasted token vouched for, empty when it vouched for nothing.
 * The comparison itself is `vcsAuthorityIsVouchedFor`, in shared types, because the
 * interface makes it too - it decides between a button and a warning.
 */
export function describeAuthority(options: {
    fingerprint: string;
    expected: string;
    subject: string;
    expiresAt: string;
    certificatePath: string;
}): VcsServerAuthority {
    const plan = authorityInstallPlan(options.certificatePath);
    return {
        fingerprint: options.fingerprint,
        expected: options.expected,
        subject: options.subject,
        expiresAt: options.expiresAt,
        path: options.certificatePath,
        canInstall: plan.canInstall,
        command: plan.command,
    };
}

/**
 * The authorities this machine came with: node's own roots and the platform's store.
 *
 * Node builds chains against its bundled roots alone unless it is told otherwise, and the
 * authorities a person installs go into the platform's store, so a connection that is to
 * agree with the rest of the machine has to be offered both.
 */
function platformCertificates(): string[] | undefined {
    // Present from node 22.15. Guarded rather than assumed because the answer this feeds
    // is "does this machine trust it", and an exception here would answer it wrongly.
    if (typeof tls.getCACertificates !== "function") return undefined;
    try {
        return [...tls.getCACertificates("default"), ...tls.getCACertificates("system")];
    } catch {
        return undefined;
    }
}

/**
 * The authorities an author has accepted here, each as its own PEM.
 *
 * Only the accepted ones. Every authority a probe meets is written to disk, because the
 * prompt has to name a file before there is an answer to it, and reading those back would
 * mean an authority somebody looked at and refused was trusted from then on.
 */
function acceptedCertificates(userDataDir: string): string[] {
    try {
        const directory = acceptedDirectory(userDataDir);
        return readdirSync(directory)
            .filter((entry) => entry.endsWith(".crt"))
            .map((entry) => readFileSync(join(directory, entry), "utf-8"));
    } catch {
        // No directory means nothing was ever accepted here, which is ordinary.
        return [];
    }
}

/**
 * The trust stores one connection is put to, in order, until one of them answers.
 *
 * **Why they are separate stores rather than one list.** OpenSSL looks an issuer up by
 * subject and takes the last certificate added under that name; it does not go on to try
 * the others. Two authorities with the same subject therefore hide one another, and this
 * product makes that likely rather than exotic: a Team server's authority is named after
 * the machine it runs on, so two servers on two machines called the same thing are two
 * different keys under one name. Merged into a single list, accepting the second would
 * silently stop the first from verifying - measured, and it reports itself as
 * `DEPTH_ZERO_SELF_SIGNED_CERT`, which reads as a server that was never trusted.
 *
 * So the platform's store is asked first, exactly as it was before anybody accepted
 * anything here, and each accepted authority is asked on its own afterwards. Nothing can
 * shadow anything, and the common case - a server whose certificate the machine already
 * agrees with - is still one connection.
 */
function trustStores(userDataDir: string): Array<string[] | undefined> {
    return [platformCertificates(), ...acceptedCertificates(userDataDir).map((pem) => [pem])];
}

/**
 * Every authority at once: the platform's, and the ones an author accepted here.
 *
 * This is what a connection that cannot be made twice has to be given, and there are two
 * of those - the Team session's socket and the transfers beside it. Both are opened to a
 * server that was added, which is to say one whose authority somebody already compared
 * and accepted, and both are built around a single connection rather than around a
 * question that can be put again.
 *
 * The cost is the shadowing {@link trustStores} exists to avoid: where two of these
 * authorities carry the same subject, the last one wins and the other stops verifying.
 * Narrower than it was - this list held every authority a probe had ever met until the
 * accepted ones were kept apart - and narrow enough to leave: what is in it is one
 * certificate per server the author added. Giving each of those two connections the one
 * authority for the server it is opening is the way out, and it wants the fingerprint the
 * session already records.
 */
export function trustedCertificates(userDataDir: string): string[] | undefined {
    const platform = platformCertificates() ?? [];
    const collected = [...platform, ...acceptedCertificates(userDataDir)];
    return collected.length === 0 ? undefined : collected;
}

/**
 * Whether a rejected connection was rejected over the certificate rather than the machine.
 *
 * The codes are node's. An `ERR_SSL_` code is not a trust question: it is what plain HTTP
 * on the port, or anything else that is not TLS, looks like from here.
 */
export function isTrustFailure(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
    if (code.startsWith("ERR_SSL_")) return false;
    return code.startsWith("ERR_TLS_") || /CERT|SELF_SIGNED|ISSUER|UNABLE_TO_/.test(code);
}

/**
 * Make the same attempt against each trust store until one is not refused over trust.
 *
 * Anything that is not a trust failure - a refused connection, a timeout, an answer -
 * ends it: those say something about the server rather than about which authorities were
 * offered, and asking again with a different list would only take longer to say the same
 * thing. The last trust failure is what is thrown when every store has refused, so the
 * caller sees the same error it would have seen with no accepted authorities at all.
 *
 * Every attempt is a fresh connection, and that is safe for what goes through here: a
 * handshake that was refused delivered nothing, so there is nothing to have happened twice.
 */
export async function reachThroughTrustStores<T>(
    userDataDir: string,
    attempt: (ca: string[] | undefined) => Promise<T>,
): Promise<T> {
    let refusal: unknown;
    for (const ca of trustStores(userDataDir)) {
        try {
            return await attempt(ca);
        } catch (error) {
            if (!isTrustFailure(error)) throw error;
            refusal = error;
        }
    }
    throw refusal;
}
