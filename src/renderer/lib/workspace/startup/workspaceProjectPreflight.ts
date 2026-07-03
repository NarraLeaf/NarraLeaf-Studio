import { RendererError, throwException } from "@shared/utils/error";
import {
    DirEntry,
    findNlprojConfigFileName,
} from "@shared/utils/nlproj";
import { BaseFileSystemService } from "../services/core/FileSystem";

export const WorkspaceStartupErrorKind = {
    MissingProjectConfig: "missing-project-config",
} as const;

export type WorkspaceStartupErrorKind = typeof WorkspaceStartupErrorKind[keyof typeof WorkspaceStartupErrorKind];

export class WorkspaceStartupError extends RendererError {
    constructor(
        public readonly kind: WorkspaceStartupErrorKind,
        public readonly projectPath: string,
        message: string,
    ) {
        super(message);
        this.name = "WorkspaceStartupError";
    }
}

export interface WorkspaceProjectPreflightIssue {
    kind: typeof WorkspaceStartupErrorKind.MissingProjectConfig;
}

export function isWorkspaceStartupError(error: Error): error is WorkspaceStartupError {
    return error instanceof WorkspaceStartupError;
}

export function getWorkspaceProjectPreflightIssue(
    entries: DirEntry[],
): WorkspaceProjectPreflightIssue | null {
    if (findNlprojConfigFileName(entries)) {
        return null;
    }

    return { kind: WorkspaceStartupErrorKind.MissingProjectConfig };
}

export async function ensureWorkspaceProjectCanStart(projectPath: string): Promise<void> {
    const entries = throwException(await BaseFileSystemService.list(projectPath));
    const dirEntries = entries.map<DirEntry>((entry) => ({
        name: entry.name,
        ext: entry.ext,
        type: entry.type,
    }));

    if (findNlprojConfigFileName(dirEntries)) {
        return;
    }

    const issue = getWorkspaceProjectPreflightIssue(dirEntries);
    if (!issue) {
        return;
    }

    throw new WorkspaceStartupError(
        issue.kind,
        projectPath,
        "Selected folder is not a NarraLeaf project.",
    );
}
