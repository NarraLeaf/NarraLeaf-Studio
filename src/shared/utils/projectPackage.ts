import msgpack from "msgpack-lite";

export const PROJECT_PACKAGE_EXTENSION = ".nlspkg";
export const PROJECT_PACKAGE_FORMAT = "narraleaf-studio.project-package";
export const PROJECT_PACKAGE_FORMAT_VERSION = 1;

const PROJECT_PACKAGE_MAGIC = new Uint8Array([
    0x4e, 0x4c, 0x53, 0x50, 0x4b, 0x47, 0x00, 0x01,
]);

export interface ProjectPackageFileEntry {
    path: string;
    data: Uint8Array;
}

export interface ProjectPackagePayload {
    format: typeof PROJECT_PACKAGE_FORMAT;
    version: typeof PROJECT_PACKAGE_FORMAT_VERSION;
    createdAt: string;
    projectName: string;
    projectIdentifier?: string;
    directories: string[];
    files: ProjectPackageFileEntry[];
}

export function encodeProjectPackage(payload: ProjectPackagePayload): Uint8Array {
    const encoded = msgpack.encode(payload);
    const payloadBytes = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    const bytes = new Uint8Array(PROJECT_PACKAGE_MAGIC.length + payloadBytes.length);
    bytes.set(PROJECT_PACKAGE_MAGIC, 0);
    bytes.set(payloadBytes, PROJECT_PACKAGE_MAGIC.length);
    return bytes;
}

export function decodeProjectPackage(bytes: Uint8Array): ProjectPackagePayload {
    if (!hasProjectPackageMagic(bytes)) {
        throw new Error("Selected file is not a NarraLeaf Studio project package.");
    }

    const decoded = msgpack.decode(bytes.slice(PROJECT_PACKAGE_MAGIC.length)) as Partial<ProjectPackagePayload>;
    if (decoded.format !== PROJECT_PACKAGE_FORMAT) {
        throw new Error("Project package format is not supported.");
    }
    if (decoded.version !== PROJECT_PACKAGE_FORMAT_VERSION) {
        throw new Error(`Project package version ${String(decoded.version)} is not supported.`);
    }
    if (!Array.isArray(decoded.files)) {
        throw new Error("Project package is missing file entries.");
    }

    const directories = Array.isArray(decoded.directories)
        ? decoded.directories.map(normalizeProjectPackagePath)
        : [];
    const files = decoded.files.map((entry) => {
        if (!entry || typeof entry.path !== "string") {
            throw new Error("Project package contains an invalid file entry.");
        }
        return {
            path: normalizeProjectPackagePath(entry.path),
            data: normalizePackageBytes(entry.data),
        };
    });

    return {
        format: PROJECT_PACKAGE_FORMAT,
        version: PROJECT_PACKAGE_FORMAT_VERSION,
        createdAt: typeof decoded.createdAt === "string" ? decoded.createdAt : "",
        projectName: typeof decoded.projectName === "string" && decoded.projectName.trim()
            ? decoded.projectName
            : "Imported Project",
        projectIdentifier: typeof decoded.projectIdentifier === "string" ? decoded.projectIdentifier : undefined,
        directories,
        files,
    };
}

export function normalizeProjectPackagePath(value: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("Project package path must be a non-empty relative path.");
    }
    if (value.includes("\0")) {
        throw new Error("Project package path contains an invalid character.");
    }

    const normalized = value.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
        throw new Error(`Project package path must be relative: ${value}`);
    }

    const segments = normalized.split("/");
    if (segments.some(segment => segment === "" || segment === "." || segment === "..")) {
        throw new Error(`Project package path contains unsafe segments: ${value}`);
    }

    return segments.join("/");
}

export function shouldExcludeProjectPackagePath(relativePath: string): boolean {
    const normalized = normalizeProjectPackagePath(relativePath).toLowerCase();
    const segments = normalized.split("/");
    const fileName = segments.at(-1) ?? "";

    if (fileName === ".ds_store" || fileName === "thumbs.db" || fileName.endsWith(PROJECT_PACKAGE_EXTENSION)) {
        return true;
    }
    if (segments[0] === ".git" || segments[0] === "node_modules") {
        return true;
    }
    if (segments[0] === "editor" && segments[1] === "cache") {
        return true;
    }
    if (segments[0] === "editor" && segments[1] === "assets" && segments[2] === "remote") {
        return true;
    }
    if (
        segments[0] === ".nlstudio" &&
        (segments[1] === "cache" ||
            segments[1] === "tmp" ||
            segments[1] === "temp" ||
            segments[1] === "dev-mode" ||
            segments[1] === "build" ||
            segments[1] === "dist")
    ) {
        return true;
    }

    return false;
}

function hasProjectPackageMagic(bytes: Uint8Array): boolean {
    if (bytes.length <= PROJECT_PACKAGE_MAGIC.length) {
        return false;
    }
    for (let index = 0; index < PROJECT_PACKAGE_MAGIC.length; index += 1) {
        if (bytes[index] !== PROJECT_PACKAGE_MAGIC[index]) {
            return false;
        }
    }
    return true;
}

function normalizePackageBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (Array.isArray(value)) {
        return new Uint8Array(value);
    }
    throw new Error("Project package contains a file entry without binary data.");
}
