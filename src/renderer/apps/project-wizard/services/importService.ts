import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { isStudioProject } from "./projectVerification";

/**
 * What an import ended as.
 *
 * `cancelled` is a first-class outcome rather than a failure. The author backing out of a native
 * file dialog is an ordinary thing to do, and reporting it as an error would put a red panel on
 * screen for someone who simply changed their mind.
 */
export type ImportOutcome =
    | { status: "imported"; root: string; projectName?: string; fileCount?: number }
    | { status: "cancelled" }
    | { status: "notAProject"; root: string }
    | { status: "failed"; error: string };

/**
 * Unpacking a project someone handed over as a `.nlspkg` file.
 *
 * **One call does the whole thing, and that is why this flow has no fields of its own.** The main
 * process puts up two native dialogs - pick the package, pick where to put it - copies the tree
 * out, and grants this window access to the result. There is nothing for a wizard page to collect
 * beforehand, so the page explains what is about to happen and the footer button starts it.
 */
export class ImportService {
    /**
     * Ask for a package and a destination, unpack it, then decide whether Studio can open what
     * came out.
     *
     * The check is the same one a clone gets, and it earns its place for the same reason: a
     * `.nlspkg` is an archive, and an archive can hold anything. Studio writes these itself, so
     * the usual case passes - but "usually correct" is exactly the kind of input that turns a
     * missing check into a launcher that fails to open a folder with no explanation.
     */
    static async importProject(): Promise<ImportOutcome> {
        try {
            const result = await getInterface().workspace.importProjectPackage();
            if (!result.success) {
                return { status: "failed", error: result.error || translate("wizard.import.error.generic") };
            }
            if (result.data.canceled || !result.data.projectPath) {
                return { status: "cancelled" };
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
            return { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
    }
}
