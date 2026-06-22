import { appPrivilegedFacade, createPluginPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { getInterface } from "@/lib/app/bridge";
import { AppHost, AppProtocol } from "@shared/types/constants";
import type {
    PluginIdentity,
    PluginPermissionGrantResult,
    PluginPermissionRequest,
} from "@shared/types/pluginPermissions";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";

export type LauncherManagedPlugin = {
    plugin: PluginIdentity;
    source: string;
    description: string;
};

export type DesktopFileTestResult = {
    targetPath: string;
    permission: PluginPermissionGrantResult;
    bytes: number;
    hash: string;
    contentPreview: string;
};

export const desktopFileTestPlugin: LauncherManagedPlugin = {
    plugin: {
        id: "studio.test.desktop-file",
        name: "Desktop File Test",
        version: "0.1.0",
        publisher: "NarraLeaf Studio",
    },
    source: "builtin://launcher/desktop-file-test",
    description: "Requests one desktop file grant and writes a small probe file.",
};

export async function requestDesktopFileTestPluginInstall(): Promise<PluginPermissionGrantResult> {
    const request: PluginPermissionRequest = {
        kind: "install",
        requestId: createRequestId("install"),
        plugin: desktopFileTestPlugin.plugin,
        source: desktopFileTestPlugin.source,
        requestedPermissions: [
            "Read and write one file on your Desktop: narraleaf-plugin-permission-test.txt",
        ],
        reason: "Install the local test plugin used to verify Launcher plugin authorization.",
        requestedAt: Date.now(),
    };

    const result = await appPrivilegedFacade.permissions.request(request);
    if (!result.success) {
        throw new Error(result.error ?? "Failed to request plugin installation");
    }
    if (!result.data?.approved) {
        throw new Error("Plugin installation was not approved");
    }
    return result.data;
}

export async function runDesktopFileTestPlugin(): Promise<DesktopFileTestResult> {
    const desktopPath = await getDesktopPath();
    const targetPath = joinPath(desktopPath, "narraleaf-plugin-permission-test.txt");
    const runtime = createPluginPrivilegedFacade(desktopFileTestPlugin.plugin);

    try {
        const permission = await requestDesktopFileGrant(runtime.app, targetPath);
        const body = [
            "NarraLeaf Studio plugin permission test",
            `plugin=${desktopFileTestPlugin.plugin.id}`,
            `time=${new Date().toISOString()}`,
            `grant=${permission.persistence}`,
            "",
        ].join("\n");

        const ensureResult = unwrapFs(await runtime.app.fs.ensureRegularFile(targetPath, body, "utf-8"));
        if (!ensureResult.ok) {
            throw new Error(ensureResult.error.message);
        }

        const writeResult = unwrapFs(await runtime.app.fs.writeFileNoFollow(targetPath, body, "utf-8"));
        if (!writeResult.ok) {
            throw new Error(writeResult.error.message);
        }

        const readResult = await readText(runtime.app, targetPath);
        if (!readResult.ok) {
            throw new Error(readResult.error.message);
        }

        const hashResult = unwrapFs(await runtime.app.fs.hash(targetPath));
        if (!hashResult.ok) {
            throw new Error(hashResult.error.message);
        }

        return {
            targetPath,
            permission,
            bytes: new Blob([readResult.data]).size,
            hash: hashResult.data,
            contentPreview: readResult.data.split("\n").slice(0, 3).join("\n"),
        };
    } finally {
        runtime.revoke();
    }
}

async function requestDesktopFileGrant(
    app: ReturnType<typeof createPluginPrivilegedFacade>["app"],
    targetPath: string,
): Promise<PluginPermissionGrantResult> {
    const request: PluginPermissionRequest = {
        kind: "filesystem",
        requestId: createRequestId("desktop-fs"),
        plugin: desktopFileTestPlugin.plugin,
        path: targetPath,
        mode: "readwrite",
        recursive: false,
        persistence: "permanent",
        reason: "The test plugin will write and then read a single file on your Desktop.",
        requestedAt: Date.now(),
    };

    const result = await app.permissions.request(request);
    if (!result.success) {
        throw new Error(result.error ?? "Failed to request desktop file permission");
    }
    if (!result.data?.approved) {
        throw new Error("Desktop file permission was not approved");
    }
    return result.data;
}

async function readText(
    app: ReturnType<typeof createPluginPrivilegedFacade>["app"],
    targetPath: string,
): Promise<FsRequestResult<string>> {
    const requestResult = unwrapFs(await app.fs.requestRead(targetPath, "utf-8"));
    if (!requestResult.ok) {
        return requestResult;
    }

    const response = await fetch(`${AppProtocol}://${AppHost.Fs}/${requestResult.data}`);
    if (!response.ok) {
        return {
            ok: false,
            error: {
                code: FsRejectErrorCode.IPC_ERROR,
                message: `Failed to read test file: ${response.statusText}`,
            },
        };
    }

    return {
        ok: true,
        data: await response.text(),
    };
}

async function getDesktopPath(): Promise<string> {
    const result = await getInterface().app.getSystemPath("desktop");
    if (!result.success) {
        throw new Error(result.error ?? "Failed to resolve desktop path");
    }
    return result.data.path;
}

function joinPath(dir: string, basename: string): string {
    const normalized = dir.replace(/[\\/]+$/, "");
    const separator = normalized.includes("\\") ? "\\" : "/";
    return `${normalized}${separator}${basename}`;
}

function createRequestId(prefix: string): string {
    const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `${prefix}:${desktopFileTestPlugin.plugin.id}:${random}`;
}

function unwrapFs<T>(result: { success: true; data: FsRequestResult<T> } | { success: false; error?: string }): FsRequestResult<T> {
    if (result.success) {
        return result.data;
    }
    return {
        ok: false,
        error: {
            code: FsRejectErrorCode.IPC_ERROR,
            message: result.error ?? "IPC request failed",
        },
    };
}
