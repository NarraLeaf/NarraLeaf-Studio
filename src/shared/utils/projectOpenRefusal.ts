import type { TranslationKey } from "@shared/i18n/catalog/types";

/**
 * Why a workspace was refused another project, as the `code` the refusal carries across IPC.
 *
 * Shared because main decides it (`requireOpenableFromWorkspace`) and the workspace and the native
 * menu both have to say it. Each is a case the launcher puts to the author as a choice before
 * anything opens; from a workspace there is no such choice to offer, so the author is sent back to
 * the launcher to make it.
 */
export const PROJECT_FOLDER_MISSING = "project-folder-missing";
export const PROJECT_NOT_A_PROJECT = "project-not-a-project";
export const TEAM_PROJECT_SIGNED_OUT = "team-project-signed-out";

export type ProjectOpenRefusal =
    | typeof PROJECT_FOLDER_MISSING
    | typeof PROJECT_NOT_A_PROJECT
    | typeof TEAM_PROJECT_SIGNED_OUT;

/** Narrow an IPC failure's code to a refusal, or null for any other failure. */
export function asProjectOpenRefusal(code: unknown): ProjectOpenRefusal | null {
    return code === PROJECT_FOLDER_MISSING || code === PROJECT_NOT_A_PROJECT || code === TEAM_PROJECT_SIGNED_OUT
        ? code
        : null;
}

/** The catalog key that explains a refusal and where to resolve it. */
export function projectOpenRefusalDetailKey(refusal: ProjectOpenRefusal): TranslationKey {
    switch (refusal) {
        case PROJECT_FOLDER_MISSING:
            return "workspace.shell.projectSwitcher.unavailable.detailFolderMissing";
        case PROJECT_NOT_A_PROJECT:
            return "workspace.shell.projectSwitcher.unavailable.detailNotAProject";
        case TEAM_PROJECT_SIGNED_OUT:
            return "workspace.shell.projectSwitcher.unavailable.detailSignedOut";
    }
}
