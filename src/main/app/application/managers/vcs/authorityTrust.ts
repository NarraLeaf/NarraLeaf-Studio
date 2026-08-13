import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
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
 * authority IS trusted costs nothing: the trust lives in the store, not here.
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
