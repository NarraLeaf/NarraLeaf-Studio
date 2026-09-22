/**
 * Why a project package could not be unpacked, as the `code` a failed
 * `workspaceImportProjectPackage` carries.
 *
 * The main process's own message is English and names paths - the package, the folder, and the file
 * inside the package that failed - which is what the log wants and what the wizard page must not
 * print. The wizard words the failure from this code instead.
 *
 * Kept apart from `@shared/utils/projectPackage`, which holds the format itself and pulls in its
 * encoder: the wizard needs the codes and nothing else.
 */
export enum ProjectPackageImportErrorCode {
    /** The file is not a `.nlspkg` at all. */
    NotAPackage = "PACKAGE_NOT_A_PACKAGE",
    /** A package written by a newer Studio, in a version this one cannot read. */
    NewerVersion = "PACKAGE_NEWER_VERSION",
    /** A package whose index or contents do not hold together: truncated, or altered. */
    Damaged = "PACKAGE_DAMAGED",
    /** The package is no longer where it was picked. */
    PackageMissing = "PACKAGE_MISSING",
    /** The disk will not let Studio read the package. */
    PackageUnreadable = "PACKAGE_UNREADABLE",
    /** The chosen folder has something in it. */
    FolderNotEmpty = "PACKAGE_FOLDER_NOT_EMPTY",
    /** The chosen folder is inside Studio's own storage, which no project may be unpacked into. */
    FolderProtected = "PACKAGE_FOLDER_PROTECTED",
    /** The disk will not let Studio write into the chosen folder. */
    FolderReadOnly = "PACKAGE_FOLDER_READ_ONLY",
    /** The disk the chosen folder is on ran out of space. */
    DiskFull = "PACKAGE_DISK_FULL",
}

const IMPORT_CODES: ReadonlySet<string> = new Set(Object.values(ProjectPackageImportErrorCode));

/** Whether a `RequestStatus.code` is one of the unpacker's. */
export function isProjectPackageImportErrorCode(code: unknown): code is ProjectPackageImportErrorCode {
    return typeof code === "string" && IMPORT_CODES.has(code);
}
