import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { isProjectPackageImportErrorCode, ProjectPackageImportErrorCode } from "@shared/types/projectPackage";
import { isStudioProject } from "./projectVerification";

/**
 * What an import ended as.
 *
 * No `cancelled`: cancelling now happens in the pickers, which simply return nothing and leave the
 * page as it was. By the time this runs the author has chosen both answers and pressed the button.
 */
export type ImportOutcome =
    | { status: "imported"; root: string; projectName?: string; fileCount?: number }
    | { status: "notAProject"; root: string }
    /** `leftBehind`: the folder still holds part of what this attempt unpacked. */
    | { status: "failed"; error: string; leftBehind: boolean };

/**
 * Why an unpack failed, in the interface's language, from the code main answered with.
 *
 * Main's own message is English and names the package, the folder and the file inside the package
 * that failed - it goes to the log. A failure with no code the page has words for (a disk error no
 * author can act on, a grant the page never asked for) gets the one general sentence.
 */
export function describePackageImportFailure(code: string | undefined): string {
    if (!isProjectPackageImportErrorCode(code)) {
        return translate("wizard.import.error.generic");
    }
    switch (code) {
        case ProjectPackageImportErrorCode.NotAPackage:
            return translate("wizard.import.error.notAPackage");
        case ProjectPackageImportErrorCode.NewerVersion:
            return translate("wizard.import.error.newerVersion");
        case ProjectPackageImportErrorCode.Damaged:
            return translate("wizard.import.error.damaged");
        case ProjectPackageImportErrorCode.PackageMissing:
            return translate("wizard.import.error.packageMissing");
        case ProjectPackageImportErrorCode.PackageUnreadable:
            return translate("wizard.import.error.packageUnreadable");
        case ProjectPackageImportErrorCode.FolderNotEmpty:
            // The same sentence the folder field gives before the button is pressed.
            return translate("wizard.validation.notEmpty");
        case ProjectPackageImportErrorCode.FolderProtected:
            return translate("wizard.import.error.folderProtected");
        case ProjectPackageImportErrorCode.FolderReadOnly:
            return translate("wizard.validation.cannotWrite");
        case ProjectPackageImportErrorCode.DiskFull:
            return translate("wizard.import.error.diskFull");
    }
}

/**
 * Unpacking a project someone handed over as a `.nlspkg` file.
 *
 * **Three calls, not one.** The package and the destination are picked separately and shown on the
 * page, so the author can see both, change either, and be told about an occupied folder before
 * anything is written. It used to be a single call that put up two native dialogs back to back,
 * with a page in front of them that could only describe what was about to happen.
 */
export class ImportService {
    /** Pick the package. Null means the dialog was dismissed, which is not an error. */
    static async selectPackage(): Promise<string | null> {
        try {
            const result = await getInterface().selectProjectPackage();
            return result.success ? result.data.dest : null;
        } catch (error) {
            console.error("Failed to select project package:", error);
            return null;
        }
    }

    /**
     * Unpack the chosen package into the chosen folder, then decide whether Studio can open what
     * came out.
     *
     * The check is the same one a clone gets, and it earns its place for the same reason: a
     * `.nlspkg` is an archive, and an archive can hold anything. Studio writes these itself, so
     * the usual case passes - but "usually correct" is exactly the kind of input that turns a
     * missing check into a launcher that fails to open a folder with no explanation.
     */
    static async importProject(packagePath: string, targetDir: string): Promise<ImportOutcome> {
        try {
            const result = await getInterface().workspace.importProjectPackage(packagePath, targetDir);
            if (!result.success) {
                console.warn("[wizard] the package could not be unpacked", result.error);
                return {
                    status: "failed",
                    error: describePackageImportFailure(result.code),
                    leftBehind: await holdsLeftovers(targetDir, result.code),
                };
            }

            const root = result.data.projectPath;
            return (await isStudioProject(root))
                ? {
                    status: "imported",
                    root,
                    projectName: result.data.projectName,
                    fileCount: result.data.fileCount,
                }
                : { status: "notAProject", root };
        } catch (error) {
            // A rejected call is the bridge's or the platform's sentence, for the log.
            console.error("[wizard] the package import threw", error);
            return { status: "failed", error: translate("wizard.import.error.generic"), leftBehind: false };
        }
    }
}

/**
 * Whether a failed unpack left part of itself in the folder.
 *
 * Main takes back what a failed unpack wrote, and says in its log when some of it would not go. The
 * page learns it by looking: the folder was empty or absent when the button was pressed (the page
 * does not offer the button otherwise), so anything in it now is what this attempt left - and it is
 * what the next attempt would be refused over, which is the thing the author needs to hear.
 *
 * Not asked when main refused the folder for being occupied: nothing was written, and the reason
 * given already says the folder is not empty.
 */
async function holdsLeftovers(targetDir: string, code: string | undefined): Promise<boolean> {
    if (code === ProjectPackageImportErrorCode.FolderNotEmpty) {
        return false;
    }
    try {
        const listed = await getInterface().fs.list(targetDir);
        return listed.success && listed.data.ok && listed.data.data.length > 0;
    } catch {
        return false;
    }
}
