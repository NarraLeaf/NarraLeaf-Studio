import { PrivilegedActor, PrivilegedCapability } from "@shared/types/privileged";
import type { AppWindow } from "./appWindow";
import {
    canUsePluginFileSystemGrantsAsWindowPolicy,
    getDeclaredDefaultCapabilities,
} from "./permissions";

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
        // Both questions from one resolve. Asking them apart costs a second real-path walk of the
        // same path, and this is the branch a whole asset library goes through: `requestReadMany`
        // authorizes every file in it, one authorization each.
        const access = await window.app.storageManager.inspectWindowPathAccess(window, fsPath, mode);
        if (access.protectedStorage) {
            return { allowed: false, reason: "Protected application storage cannot be accessed" };
        }
        return {
            allowed: access.granted,
            reason: "Window file system policy denied access",
        };
    }

    // ⚠ **Refused, not folded.** Every check below reads a resolved spelling, and resolving folds a
    // `..` away: `granted/link/../x` is judged as `granted/x`. The operation is then handed the path
    // as given, and the system walks it through the link and back up from wherever that points - out
    // of the grant, as far as protected storage. A plugin has no reason to spell a parent step, so
    // one that does is refused before anything is resolved.
    if (hasParentSegment(fsPath)) {
        return { allowed: false, reason: `Plugin paths may not step up a directory: ${actor.pluginId}` };
    }

    if (await window.app.storageManager.isPathProtected(fsPath)) {
        return { allowed: false, reason: "Protected application storage cannot be accessed" };
    }

    const pluginAllowed = window.app.pluginPermissionManager.isPluginFileSystemAllowed(
        actor.pluginId,
        actor.version,
        fsPath,
        mode,
    );
    if (!pluginAllowed) {
        return {
            allowed: false,
            reason: `Plugin file system permission denied: ${actor.pluginId}`,
        };
    }

    const windowAllowed = await window.app.storageManager.isPathAllowed(window, fsPath, mode);
    if (!windowAllowed && !canUsePluginFileSystemGrantsAsWindowPolicy(window)) {
        return { allowed: false, reason: "Window file system policy denied access" };
    }

    return {
        allowed: true,
    };
}

function hasParentSegment(fsPath: string): boolean {
    return fsPath.split(/[\\/]/).includes("..");
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
        actor.version,
        capability,
    );
    return {
        allowed: pluginAllowed,
        reason: `Plugin capability permission denied: ${actor.pluginId}:${capability}`,
    };
}
