import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
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
  | { status: "failed"; error: string };

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
        return {
          status: "failed",
          error: result.error || translate("wizard.import.error.generic")
        };
      }

      const root = result.data.projectPath;
      return (await isStudioProject(root))
        ? {
            status: "imported",
            root,
            projectName: result.data.projectName,
            fileCount: result.data.fileCount
          }
        : { status: "notAProject", root };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }
}
