import fs from "fs/promises";
import path from "path";
import { SANDBOX_PROBE, SANDBOX_SWITCH, type SandboxProbePlan } from "@shared/utils/runtimeStartupArguments";

/**
 * The launcher every Linux game package starts through.
 *
 * Chromium aborts before any of the game's code runs on a Linux machine that can give it neither of
 * its two sandboxes - unprivileged user namespaces, or the setuid helper `chrome-sandbox`. Both are
 * commonly missing: Ubuntu 23.10 and later restrict user namespaces out of the box, and the helper
 * only works when owned by root with mode 4755, which no zip, folder or AppImage can carry. The one
 * thing that gets such a machine past the abort is the sandbox switch on the command line, and it has
 * to be there before Chromium starts - which nothing inside the game can arrange.
 *
 * So the file players and Steam start is a small POSIX shell script with the executable's name. It
 * examines the machine the way the game does (both read `SANDBOX_PROBE`), adds the switch only when
 * neither sandbox is available, and hands everything else over unchanged. The game then examines the
 * machine again for itself and refuses the switch where a sandbox was available, so the script is a
 * convenience for players and not something the game trusts.
 *
 * The real Electron binary keeps its directory, because Chromium finds the helper, its resources,
 * locales, ICU data and V8 snapshots - and the loader finds its shared libraries - relative to the
 * directory of the running executable. It is renamed by a suffix rather than given a new name so
 * that process lists and crash reports still show which game it is, and a player listing the folder
 * sees the pair side by side. None of Chromium's own files can collide with it: they all have fixed
 * names of their own.
 *
 * An AppImage composes with this unchanged: its AppRun executes the executable's name - now this
 * script - after making its own user-namespace test and adding the switch when that fails. The
 * script passes a switch that is already there straight through, and the game decides as it always
 * does.
 */

/** What the real Electron binary is renamed to, after the executable's name. */
export const LINUX_PROGRAM_SUFFIX = ".bin";

/** The first bytes of every ELF file: what an Electron binary for Linux begins with. */
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

/** One shell word, quoted so that nothing in it is expanded: a game's name can hold `$` or a backtick. */
function shellWord(text: string): string {
    return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The launcher script for an executable called `executableName`.
 *
 * Kept to POSIX `sh` and tools every Linux desktop has (`readlink -f`, `find`, `env`, `cat`), since a
 * player's `/bin/sh` may be dash or busybox. `plan` is what the machine is examined with; always the
 * shared one outside tests.
 */
export function renderLinuxLauncher(executableName: string, plan: SandboxProbePlan = SANDBOX_PROBE): string {
    const sandboxSwitch = shellWord(`--${SANDBOX_SWITCH}`);
    const lines = [
        "#!/bin/sh",
        "# Starts this game. Every argument given here is passed on unchanged.",
        "#",
        `# The game itself is the program named below, beside this file. It is built on Chromium, which`,
        `# runs its pages in a sandbox and on Linux builds that sandbox from either unprivileged user`,
        `# namespaces or the setuid helper beside the program. Where neither works, Chromium does not start`,
        `# at all. Both are often missing: some distributions restrict user namespaces (Ubuntu 23.10 and`,
        `# later do by default), and the helper only works when it is owned by root with mode 4755, which`,
        `# a download cannot carry. On such a machine, and only there, this asks Chromium to run without a`,
        `# sandbox. The game examines the machine again for itself and refuses the request wherever a`,
        `# sandbox was available.`,
        "",
        `here=$(dirname "$(readlink -f "$0" 2>/dev/null || printf '%s\\n' "$0")")`,
        `program="$here"/${shellWord(executableName + LINUX_PROGRAM_SUFFIX)}`,
        "",
        "# Succeeds when Chromium could build a sandbox here: the setuid helper is set up the way Chromium",
        "# checks it (owned by root, setuid, executable by everyone), or a user namespace can be created.",
        "can_sandbox() {",
        `    helper="$here"/${shellWord(plan.helper)}`,
        `    if [ -x "$helper" ] && [ -n "$(find "$helper" -maxdepth 0 -user 0 -perm -4001 2>/dev/null)" ]; then`,
        "        return 0",
        "    fi",
        "    # From a fixed place and with a fixed environment, so the answer is the kernel's.",
        `    for unshare in ${plan.programs.map(shellWord).join(" ")}; do`,
        `        if [ -x "$unshare" ]; then`,
        `            env -i PATH=/usr/bin:/bin "$unshare" ${plan.programArguments.map(shellWord).join(" ")} >/dev/null 2>&1`,
        "            return",
        "        fi",
        "    done",
        "    # Nothing to make the test with: only a kernel setting that rules user namespaces out says no.",
        ...plan.restrictions.map(restriction =>
            `    [ "$(cat ${shellWord(restriction.file)} 2>/dev/null)" = ${shellWord(restriction.value)} ] && return 1`),
        "    return 0",
        "}",
        "",
        "for argument in \"$@\"; do",
        `    if [ "$argument" = ${sandboxSwitch} ]; then`,
        `        exec "$program" "$@"`,
        "    fi",
        "done",
        "if can_sandbox; then",
        `    exec "$program" "$@"`,
        "fi",
        `exec "$program" ${sandboxSwitch} "$@"`,
        "",
    ];
    return lines.join("\n");
}

/**
 * Put the launcher in front of the Electron binary in a packed Linux app directory.
 *
 * `<appOutDir>/<executableName>` must be the Electron binary when this runs; it becomes
 * `<executableName>.bin`, and a launcher with mode 0755 takes its name. Anything that is not an ELF
 * binary there is refused rather than wrapped - a second pass over the same directory would
 * otherwise rename the launcher over the program.
 */
export async function installLinuxLauncher(
    appOutDir: string,
    executableName: string,
    plan: SandboxProbePlan = SANDBOX_PROBE,
): Promise<void> {
    if (!executableName || executableName.includes("/") || executableName.includes("\0")
        || executableName === "." || executableName === "..") {
        throw new Error(`Not a file name for the Linux executable: ${JSON.stringify(executableName)}`);
    }
    const launcher = path.join(appOutDir, executableName);
    const program = launcher + LINUX_PROGRAM_SUFFIX;
    const handle = await fs.open(launcher, "r");
    let head: Buffer;
    try {
        head = Buffer.alloc(ELF_MAGIC.length);
        await handle.read(head, 0, head.length, 0);
    } finally {
        await handle.close();
    }
    if (!head.equals(ELF_MAGIC)) {
        throw new Error(`${launcher} is not the Electron binary, so it cannot be put behind the Linux launcher`);
    }
    await fs.rename(launcher, program);
    await fs.writeFile(launcher, renderLinuxLauncher(executableName, plan), { mode: 0o755 });
    // `mode` above is subject to the umask; the launcher has to be executable whatever it is.
    await fs.chmod(launcher, 0o755);
}
