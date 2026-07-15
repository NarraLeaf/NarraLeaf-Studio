import { getInterface } from "@/lib/app/bridge";

/**
 * The launcher's "new project" and "open project" flows.
 *
 * Extracted from the Projects tab so the macOS File menu can drive the same code: the menu is
 * handled at the app level (a tab can be unmounted when the user is on another tab), and two
 * copies of these flows would drift.
 *
 * Each returns an error message to display, or null when it succeeded or the user cancelled.
 */

export async function createProjectFromWizard(): Promise<string | null> {
    const result = await getInterface().app.launchProjectWizard({});
    if (!result.success) {
        return result.error ?? "";
    }
    if (!result.data?.created) {
        // User cancelled the wizard.
        return null;
    }

    await getInterface().workspace.launch(
        { projectPath: result.data.projectPath },
        true, // Close launcher window after opening workspace
    );
    return null;
}

export async function openProjectFromFolder(): Promise<string | null> {
    const result = await getInterface().selectFolder();
    if (!result.success) {
        return result.error ?? "";
    }
    if (!result.data.path) {
        // User cancelled the folder picker.
        return null;
    }

    await getInterface().workspace.launch(
        { projectPath: result.data.path },
        true,
    );
    return null;
}
