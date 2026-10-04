import fs from "fs/promises";
import type { AppImageToolset } from "./appImageToolset";
import {
    fileHandleSink,
    squashfsZstdAvailable,
    writeSquashfs,
    type SquashfsCompression,
    type SquashfsEntry,
} from "./squashfs";
import { EXECUTABLE_MODE, REGULAR_FILE_MODE } from "./unixModes";

/**
 * An AppImage assembled the way electron-builder assembles one, for a host it cannot do it on.
 *
 * electron-builder's AppImage target (`app-builder-lib/out/targets/appimage/`) builds a staging
 * folder - a launcher script, a desktop entry, the icons, the toolset's libraries, then the packaged
 * app copied over the top - runs `mksquashfs` on it, and writes the runtime over the front of the
 * result. This produces the same image from entries instead of a folder (see `squashfs.ts` for why)
 * and writes it after the same runtime, for `toolsets: { appimage: "1.0.3" }`: the static runtime,
 * which starts on a stock Ubuntu 24.04 where the older FUSE 2 one finds no libfuse2.
 *
 * ## Staying in step with electron-builder
 *
 * This is a port, not a fork. Every piece of text it writes - the launcher, the desktop entry - and
 * every decision about where things go comes from electron-builder's own code, and
 * `appImage.test.ts` keeps it that way against the electron-builder that is installed: it runs
 * electron-builder's generators beside these and requires identical output, and it fingerprints the
 * functions whose decisions are ported by reading rather than by output - the staging order, the
 * icon layout, the `mksquashfs` flags, the compression electron-builder picks. Upgrading
 * electron-builder in a way that changes any of them fails that test with a message saying which,
 * and the fix is to read the change and port it, then take the new fingerprint.
 *
 * What a Studio build cannot ask for is not ported: file associations and their MIME package,
 * protocol handlers, custom desktop-entry fields and actions, launcher arguments, a category other
 * than electron-builder's default. `builderConfiguration` in `runGameBuild.ts` sets none of them, so
 * on every host the AppImage electron-builder makes for a Studio game has none of them either.
 *
 * ## What is left out on purpose
 *
 * The block map electron-builder appends after the image. It is read by one thing, electron-updater,
 * to download only the changed parts of a new version, and Studio's games are built with
 * `publish: null` and never update themselves; the runtime ignores anything past the filesystem.
 * Leaving it out changes nothing a player can see. Should games ever self-update, it would be
 * written here after the image, in electron-builder's format.
 */

/** One rendered icon. electron-builder puts every size under `hicolor` and links the largest. */
export type AppImageIcon = {
    /** Edge length in pixels; icons are square. */
    size: number;
    png: Uint8Array;
};

export type AppImageOptions = {
    /**
     * The packaged app: what electron-builder's `linux-unpacked` folder holds, paths relative to it,
     * modes already decided (see `unixModes.ts`). It lands at the root of the image, over anything
     * the staging put there, as electron-builder copies the app folder over its staging folder.
     */
    app: readonly SquashfsEntry[];
    toolset: AppImageToolset;
    /** The app's executable, and the name of its icon and desktop entry. */
    executableName: string;
    /** The name a player sees: the desktop entry's `Name`. */
    productName: string;
    /** `productName` made safe as a file name; names the folder the licence acceptance is kept in. */
    productFilename: string;
    /** The desktop entry's `X-AppImage-Version`: electron-builder's build version, the app's version unless overridden. */
    version: string;
    /** The desktop entry's `Comment`. */
    description?: string;
    /** `desktopName` from the app's package.json, which becomes `StartupWMClass` when set. */
    desktopName?: string;
    /** At least one. All PNG; the largest becomes the image's own icon. */
    icons: readonly AppImageIcon[];
    /**
     * A licence the launcher asks a player to accept on first run - electron-builder's `license`
     * option, a `.txt` or `.html` file. Studio's builds set none.
     */
    license?: { fileName: string; content: Uint8Array };
    /** Default zstd when this Node has it, else gzip; see {@link appImageCompression}. */
    compression?: SquashfsCompression;
    /** Timestamp for every file in the image, seconds since the epoch. Defaults to now. */
    mtime?: number;
    concurrency?: number;
};

export type AppImageResult = {
    /** Total length of the AppImage. */
    size: number;
    /** Where the squashfs image starts: the runtime's length. */
    offset: number;
};

/** Where `copyIcons` puts icons, relative to the image root. */
const ICON_DIR = "usr/share/icons/hicolor";

/** The launcher's name, electron-builder's `APP_RUN_ENTRYPOINT`. */
const APP_RUN = "AppRun";

/**
 * The compression electron-builder gives a static-runtime AppImage when the build asks for
 * `compression: "maximum"`, as Studio's always does: zstd. The static runtime can mount zstd and gzip
 * and nothing else. gzip only for a Node without zstd, which Studio's own Electron is not.
 */
export function appImageCompression(): SquashfsCompression {
    return squashfsZstdAvailable() ? "zstd" : "gzip";
}

/**
 * Every entry of the image, staging first and the app over it, as electron-builder's staging
 * folder would hold them when `mksquashfs` runs.
 */
export function appImageEntries(options: AppImageOptions): SquashfsEntry[] {
    validateCriticalPathString(options.executableName, "executableName");
    validateCriticalPathString(options.productFilename, "productFilename");
    if (options.icons.length === 0) {
        throw new Error("At least one icon is required for AppImage");
    }

    const staged = new Map<string, SquashfsEntry>();
    const put = (entry: SquashfsEntry): void => {
        // A later entry replaces an earlier one at the same path, as a copy over a folder does.
        staged.delete(entry.path);
        staged.set(entry.path, entry);
    };

    put({
        kind: "file",
        path: `${options.executableName}.desktop`,
        mode: REGULAR_FILE_MODE,
        content: Buffer.from(appImageDesktopEntry(options), "utf8"),
    });

    // Smallest first, as electron-builder's icon lists always are, so the last is the largest.
    const icons = [...options.icons].sort((a, b) => a.size - b.size);
    const iconFileName = `${options.executableName}.png`;
    for (const icon of icons) {
        put({ kind: "file", path: `${ICON_DIR}/${icon.size}x${icon.size}/apps/${iconFileName}`, mode: REGULAR_FILE_MODE, content: icon.png });
    }
    const largest = icons[icons.length - 1];
    const largestPath = `${ICON_DIR}/${largest.size}x${largest.size}/apps/${iconFileName}`;
    put({ kind: "symlink", path: iconFileName, target: largestPath });
    put({ kind: "symlink", path: ".DirIcon", target: largestPath });

    let eula: { fileName: string; isHtml: boolean } | undefined;
    if (options.license) {
        validateCriticalPathString(options.license.fileName, "licenseBaseName");
        put({ kind: "file", path: options.license.fileName, mode: REGULAR_FILE_MODE, content: options.license.content });
        eula = { fileName: options.license.fileName, isHtml: options.license.fileName.toLowerCase().endsWith(".html") };
    }

    put({
        kind: "file",
        path: APP_RUN,
        mode: EXECUTABLE_MODE,
        content: Buffer.from(appRunScript({
            executableName: options.executableName,
            productName: options.productName,
            productFilename: options.productFilename,
            ...(eula ? { eula } : {}),
        }), "utf8"),
    });

    for (const library of options.toolset.libraries) {
        put(library);
    }
    for (const entry of options.app) {
        put(entry);
    }
    return [...staged.values()];
}

/**
 * Write the AppImage to `output`: the runtime, then the image, the file left executable.
 */
export async function writeAppImage(output: string, options: AppImageOptions): Promise<AppImageResult> {
    const entries = appImageEntries(options);
    const runtime = options.toolset.runtime;
    await fs.rm(output, { force: true });
    const handle = await fs.open(output, "w");
    let result: AppImageResult;
    try {
        let done = 0;
        while (done < runtime.length) {
            const { bytesWritten } = await handle.write(runtime, done, runtime.length - done, done);
            done += bytesWritten;
        }
        // The runtime finds the image where its own ELF file ends, so it starts right after it.
        const image = await writeSquashfs(entries, fileHandleSink(handle, runtime.length), {
            compression: options.compression ?? appImageCompression(),
            ...(options.mtime !== undefined ? { mtime: options.mtime } : {}),
            ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        });
        result = { size: runtime.length + image.imageSize, offset: runtime.length };
    } catch (error) {
        await handle.close().catch(() => undefined);
        await fs.rm(output, { force: true }).catch(() => undefined);
        throw error;
    }
    await handle.close();
    // Meaningless on NTFS, where the bit cannot be stored - a Windows host has to deliver the file in
    // something that carries it - and what electron-builder does everywhere else.
    await fs.chmod(output, EXECUTABLE_MODE).catch(() => undefined);
    return result;
}

// ---------------------------------------------------------------------------------------------
// Ported from electron-builder. Held to its output by appImage.test.ts.

/**
 * electron-builder's `validateCriticalPathString` (appImageUtil.js): the executable and product
 * file names are embedded in the launcher's bash strings and used as paths, so they are limited to
 * characters safe in both.
 */
export function validateCriticalPathString(value: string, fieldName: string): void {
    if (!/^[\p{L}\p{N}._\- ]+$/u.test(value)) {
        throw new Error(
            `${fieldName} contains characters that cannot be safely used in file paths: ${value}. `
            + "Please use only letters, digits, hyphens, underscores, dots, and spaces.",
        );
    }
}

/** electron-builder's `desktopStringEscape` (LinuxTargetHelper.js). */
function desktopStringEscape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

function isEmptyOrSpaces(value: string | undefined): boolean {
    return value == null || value.trim().length === 0;
}

/**
 * The desktop entry `AppImageTarget` asks `LinuxTargetHelper.computeDesktopEntry` for, with the
 * options a Studio build can set: `Exec` is the launcher and `%U` (the static toolset adds no
 * `--no-sandbox`; the launcher decides that at start), the version goes in `X-AppImage-Version`,
 * and with no category configured electron-builder files every app under `Utility`.
 */
export function appImageDesktopEntry(options: Pick<AppImageOptions, "productName" | "executableName" | "version" | "description" | "desktopName">): string {
    const desktopName = options.desktopName?.trim();
    const wmClass = !isEmptyOrSpaces(desktopName) ? desktopName!.replace(/\.desktop$/, "") : options.productName;
    const fields: Array<[string, string]> = [
        ["Name", desktopStringEscape(options.productName)],
        ["Exec", `${APP_RUN} %U`],
        ["Terminal", "false"],
        ["Type", "Application"],
        ["Icon", options.executableName],
        ["StartupWMClass", desktopStringEscape(wmClass)],
        ["X-AppImage-Version", options.version],
    ];
    if (!isEmptyOrSpaces(options.description)) {
        fields.push(["Comment", desktopStringEscape(options.description!)]);
    }
    fields.push(["Categories", "Utility;"]);
    return `[Desktop Entry]${fields.map(([key, value]) => `\n${key}=${value}`).join("")}\n`;
}

/** electron-builder's `escapeShellString` (appImageUtil.js): single-quoted, inner quotes closed and escaped. */
function escapeShellString(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

export type AppRunOptions = {
    executableName: string;
    productName: string;
    productFilename: string;
    eula?: { fileName: string; isHtml: boolean };
};

/**
 * The `AppRun` launcher, electron-builder's `generateAppRunScript` (appImageUtil.js) byte for byte.
 *
 * Worth knowing what it does, since it is what a player's double-click runs: it finds the mounted
 * image, puts its `usr/lib` on the library path, probes whether unprivileged user namespaces work
 * (`unshare -Ur true`) and adds `--no-sandbox` to the app's arguments when they do not, optionally
 * shows a licence, then execs the app.
 */
export function appRunScript(options: AppRunOptions): string {
    const eula = options.eula;
    return `#!/usr/bin/env bash
set -e

THIS="$0"
# http://stackoverflow.com/questions/3190818/
args=("$@")
NUMBER_OF_ARGS="$#"

if [ -z "$APPDIR" ] ; then
  # Find the AppDir. It is the directory that contains AppRun.
  # This assumes that this script resides inside the AppDir or a subdirectory.
  # If this script is run inside an AppImage, then the AppImage runtime likely has already set $APPDIR
  path="$(dirname "$(readlink -f "\${THIS}")")"
  while [[ "$path" != "" && ! -e "$path/${APP_RUN}" ]]; do
    path=\${path%/*}
  done
  APPDIR="$path"
fi

if [ -z "$APPDIR" ] ; then
  echo "ERROR: could not locate the AppDir. Ensure this script is run from within a properly structured AppImage." >&2
  exit 1
fi

export PATH="\${APPDIR}:\${APPDIR}/usr/sbin\${PATH:+:\${PATH}}"
export XDG_DATA_DIRS="\${APPDIR}/usr/share/\${XDG_DATA_DIRS:+:\${XDG_DATA_DIRS}}:/usr/share/gnome:/usr/local/share/:/usr/share/"
export LD_LIBRARY_PATH="\${APPDIR}/usr/lib\${LD_LIBRARY_PATH:+:\${LD_LIBRARY_PATH}}"
export GSETTINGS_SCHEMA_DIR="\${APPDIR}/usr/share/glib-2.0/schemas\${GSETTINGS_SCHEMA_DIR:+:\${GSETTINGS_SCHEMA_DIR}}"

BIN="$APPDIR/${options.executableName}"

if [ -z "$APPIMAGE_EXIT_AFTER_INSTALL" ] ; then
  trap atexit EXIT
fi

isEulaAccepted=1

HAVE_NO_SANDBOX=0
for arg in "\${args[@]}" ; do
  if [ "$arg" = --no-sandbox ] ; then
    HAVE_NO_SANDBOX=1
    break
  fi
done
NO_SANDBOX=()
# Use 'unshare -Ur true' as a heuristic to detect whether user namespaces are available.
# Notes:
#   - When running as root, this check will always succeed even if the sandbox configuration
#     actually relies on unprivileged user namespaces. In practice, Chrome/Electron usually
#     disables or adjusts the sandbox separately when running as root, so this probe is mostly
#     a no-op in that scenario.
#   - On minimal systems (e.g. Alpine or stripped-down containers) 'unshare' may not exist.
#     In that case the shell will return exit code 127 ("command not found"), which will cause
#     us to add '--no-sandbox'. This is an intentional fail-safe: we prefer the app to start
#     without sandboxing rather than crash on startup.
if [ $HAVE_NO_SANDBOX -eq 0 ] && ! unshare -Ur true 2>/dev/null ; then
  NO_SANDBOX=(--no-sandbox)
fi

atexit()
{
  if [ $isEulaAccepted == 1 ] ; then
    if [ $NUMBER_OF_ARGS -eq 0 ] ; then
      exec "$BIN" "\${NO_SANDBOX[@]}"
    else
      exec "$BIN" "\${NO_SANDBOX[@]}" "\${args[@]}"
    fi
  fi
}

error()
{
  if [ -x /usr/bin/zenity ] ; then
    LD_LIBRARY_PATH="" zenity --error --text "\${1}" 2>/dev/null
  elif [ -x /usr/bin/kdialog ] ; then
    LD_LIBRARY_PATH="" kdialog --msgbox "\${1}" 2>/dev/null
  elif [ -x /usr/bin/Xdialog ] ; then
    LD_LIBRARY_PATH="" Xdialog --msgbox "\${1}" 2>/dev/null
  else
    echo "\${1}"
  fi
  exit 1
}

yesno()
{
  TITLE=$1
  TEXT=$2
  if [ -x /usr/bin/zenity ] ; then
    LD_LIBRARY_PATH="" zenity --question --title="$TITLE" --text="$TEXT" 2>/dev/null || exit 0
  elif [ -x /usr/bin/kdialog ] ; then
    LD_LIBRARY_PATH="" kdialog --title "$TITLE" --yesno "$TEXT" || exit 0
  elif [ -x /usr/bin/Xdialog ] ; then
    LD_LIBRARY_PATH="" Xdialog --title "$TITLE" --clear --yesno "$TEXT" 10 80 || exit 0
  else
    echo "zenity, kdialog, Xdialog missing. Skipping \${THIS}."
    exit 0
  fi
}

check_dep()
{
  DEP=$1
  if ! command -v "$DEP" &>/dev/null ; then
    echo "$DEP is missing. Skipping \${THIS}."
    exit 0
  fi
}

if [ -z "$APPIMAGE" ] ; then
  APPIMAGE="$APPDIR/${APP_RUN}"
  # not running from within an AppImage; hence using the AppRun for Exec=
fi

${eula
        ? `if [ -z "$APPIMAGE_SILENT_INSTALL" ] ; then
  EULA_MARK_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/${options.productFilename}"
  EULA_MARK_FILE="$EULA_MARK_DIR/eulaAccepted"
  # show EULA only if desktop file doesn't exist
  if [ ! -e "$EULA_MARK_FILE" ] ; then
    if [ -x /usr/bin/zenity ] ; then
      # on cancel simply exits and our trap handler launches app, so, $isEulaAccepted is set here to 0 and then to 1 if EULA accepted
      isEulaAccepted=0
      LD_LIBRARY_PATH="" zenity --text-info --title=${escapeShellString(options.productName)} --filename="$APPDIR/${eula.fileName}" --ok-label=Agree --cancel-label=Disagree ${eula.isHtml ? "--html" : ""}
    elif [ -x /usr/bin/Xdialog ] ; then
      isEulaAccepted=0
      LD_LIBRARY_PATH="" Xdialog --title ${escapeShellString(options.productName)} --textbox "$APPDIR/${eula.fileName}" 30 80 --ok-label Agree --cancel-label Disagree
    elif [ -x /usr/bin/kdialog ] ; then
      # cannot find any option to force Agree/Disagree buttons for kdialog. And official example exactly with OK button https://techbase.kde.org/Development/Tutorials/Shell_Scripting_with_KDE_Dialogs#Example_21._--textbox_dialog_box
      # in any case we pass labels text
      isEulaAccepted=0
      LD_LIBRARY_PATH="" kdialog --textbox "$APPDIR/${eula.fileName}" --yes-label Agree --cancel-label "Disagree"
    fi

    case $? in
      0)
          isEulaAccepted=1
          echo "License accepted"
          mkdir -p "$EULA_MARK_DIR"
          touch "$EULA_MARK_FILE"
      ;;
        1)
          echo "License not accepted"
          exit 0
      ;;
        -1)
          echo "An unexpected error has occurred."
          isEulaAccepted=1
      ;;
    esac
  fi
fi`
        : ""}
`;
}
