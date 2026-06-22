import { PrivilegedActor, PrivilegedCapability } from "@shared/types/privileged";
import type { AppWindow } from "./appWindow";
import { getDeclaredDefaultCapabilities } from "./permissions";

export type ActorAuthorizationResult = {
    allowed: boolean;
    reason?: string;
};

export async function authorizeActorFileSystemRequest(
    window: AppWindow,
    actor: PrivilegedActor,
    fsPath: string,
    mode: "read" | "write",
): Promise<ActorAuthorizationResult> {
    if (actor.kind === "facade") {
        if (actor.id !== "default") {
            return { allowed: false, reason: `Unknown facade actor: ${actor.id}` };
        }
        return {
            allowed: await window.app.storageManager.isPathAllowed(window, fsPath, mode),
            reason: "Window file system policy denied access",
        };
    }

    const windowAllowed = await window.app.storageManager.isPathAllowed(window, fsPath, mode);
    if (!windowAllowed) {
        return { allowed: false, reason: "Window file system policy denied access" };
    }

    const pluginAllowed = window.app.pluginPermissionManager.isPluginFileSystemAllowed(
        actor.pluginId,
        fsPath,
        mode,
    );
    return {
        allowed: pluginAllowed,
        reason: `Plugin file system permission denied: ${actor.pluginId}`,
    };
}

export function authorizeActorCapabilityRequest(
    window: AppWindow,
    actor: PrivilegedActor,
    capability: PrivilegedCapability | string,
): ActorAuthorizationResult {
    if (actor.kind === "facade") {
        if (actor.id !== "default") {
            return { allowed: false, reason: `Unknown facade actor: ${actor.id}` };
        }
        const available = new Set<string>(getDeclaredDefaultCapabilities(window));
        return {
            allowed: available.has(capability),
            reason: `Window capability policy denied access: ${capability}`,
        };
    }

    const pluginAllowed = window.app.pluginPermissionManager.isPluginCapabilityAllowed(
        actor.pluginId,
        capability,
    );
    return {
        allowed: pluginAllowed,
        reason: `Plugin capability permission denied: ${actor.pluginId}:${capability}`,
    };
}
