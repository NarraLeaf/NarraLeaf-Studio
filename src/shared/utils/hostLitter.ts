import { ATOMIC_WRITE_TEMP_SUFFIX } from "./atomicWriteTemp";

/**
 * Files a machine leaves in folders it touches, which are never anybody's content.
 *
 * A build copies several folders it did not write: the Electron distribution it packages, and the
 * directories an author hands over whole - a model bundle, a puppet runtime backend. Each of those
 * folders has lived on somebody's disk, and a disk accumulates things nobody put there on purpose:
 * Finder's `.DS_Store` in every folder a Mac user opened, Explorer's `Thumbs.db` and `desktop.ini`,
 * the `._` twins macOS writes beside every file it copies onto a volume that has no resource forks,
 * an editor's swap file, a `.git` checkout the folder was cloned as. A build that copies such a
 * folder wholesale ships all of it to every player.
 *
 * Matched by name, at any depth. Every name here belongs to a tool or to the operating system, and
 * none of them can be something a game reads - which is what makes matching everywhere safe, and
 * what the list must keep being true of. A name that could plausibly be content (`dist`, `cache`,
 * `node_modules`, `*.log`) does not belong here, however often it is junk.
 *
 * Callers that leave such a file out of a build say so in the build log, so an author who did mean
 * to ship one (nobody should) can see where it went.
 */

/** What produced a name {@link hostLitterKind} recognises. */
export type HostLitterKind =
    /** A file manager or the operating system's own bookkeeping. */
    | "file-manager"
    /** An editor's swap, lock or backup file, left while a file is open or after it was saved. */
    | "editor"
    /** A version control checkout's metadata. */
    | "version-control"
    /** Studio's own atomic writer, caught between writing its scratch file and renaming it. */
    | "studio";

/**
 * Names compared case-insensitively. Windows creates `desktop.ini` and `Thumbs.db` in whichever
 * case it pleases and the file systems they live on do not distinguish, so neither does this.
 */
const FILE_MANAGER_NAMES: ReadonlySet<string> = new Set([
    // macOS Finder: per-folder view settings.
    ".ds_store",
    // macOS: AppleDouble folders (netatalk, some network shares) and the folder Archive Utility adds
    // to every zip it makes, holding one `._` twin per file.
    ".appledouble",
    "__macosx",
    // macOS volume bookkeeping. They live at a volume's root, which an author's folder is when it
    // is a USB stick or a disk image.
    ".spotlight-v100",
    ".trashes",
    ".fseventsd",
    ".temporaryitems",
    // A folder's custom Finder icon. The name really is `Icon` followed by a carriage return.
    "icon\r",
    // Windows Explorer: thumbnail caches and per-folder view settings.
    "thumbs.db",
    "ehthumbs.db",
    "ehthumbs_vista.db",
    "desktop.ini",
    // KDE Dolphin: per-folder view settings.
    ".directory",
]);

const VERSION_CONTROL_NAMES: ReadonlySet<string> = new Set([".git", ".svn", ".hg"]);

/** What left `name` behind, or null when it is an ordinary name that might be content. */
export function hostLitterKind(name: string): HostLitterKind | null {
    const lower = name.toLowerCase();
    // `._<name>`: the AppleDouble twin macOS writes beside every file it copies to a volume
    // without resource forks (FAT, exFAT, SMB), which is how they reach Windows machines.
    if (FILE_MANAGER_NAMES.has(lower) || name.startsWith("._")) {
        return "file-manager";
    }
    if (VERSION_CONTROL_NAMES.has(lower)) {
        return "version-control";
    }
    if (lower.endsWith(ATOMIC_WRITE_TEMP_SUFFIX)) {
        return "studio";
    }
    if (isEditorLeftover(name)) {
        return "editor";
    }
    return null;
}

/** Whether `name` (a single path segment, not a path) is {@link hostLitterKind host litter}. */
export function isHostLitter(name: string): boolean {
    return hostLitterKind(name) !== null;
}

/**
 * Swap, lock and backup files, by the shapes the editors that write them use.
 *
 *  - `~$report.docx`: Microsoft Office's owner file, present while a document is open.
 *  - `.texture.png.swp` (and `.swo`, `.swn` ... `.swa`): Vim's swap files, always hidden.
 *  - `texture.png~`: the backup Emacs, gedit and many others leave after a save.
 *  - `.#texture.png` and `#texture.png#`: Emacs' lock file and its auto-save file.
 */
function isEditorLeftover(name: string): boolean {
    return name.startsWith("~$")
        || /^\..+\.sw[a-p]$/i.test(name)
        || (name.length > 1 && name.endsWith("~"))
        || name.startsWith(".#")
        || (name.length > 2 && name.startsWith("#") && name.endsWith("#"));
}
