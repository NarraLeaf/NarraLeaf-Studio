import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { PrivilegedActor } from "@shared/types/privileged";

export type FacadeToken = object;
export type PluginFacadeToken = object;
export type PrivilegedFacadeToken = FacadeToken | PluginFacadeToken;

const tokenActors = new WeakMap<object, PrivilegedActor>();

function createToken(actor: PrivilegedActor): object {
    const token = Object.freeze(Object.create(null));
    tokenActors.set(token, actor);
    return token;
}

export const defaultFacadeToken: FacadeToken = createToken({ kind: "facade", id: "default" });

export function createPluginFacadeToken(plugin: PluginIdentity | string): PluginFacadeToken {
    const normalized = (typeof plugin === "string" ? plugin : plugin.id).trim();
    if (!normalized) {
        throw new Error("Plugin id is required");
    }
    const version = typeof plugin === "string" ? undefined : plugin.version?.trim();
    return createToken({ kind: "plugin", pluginId: normalized, ...(version ? { version } : {}) });
}

export function resolvePrivilegedActor(token: PrivilegedFacadeToken): PrivilegedActor {
    const actor = tokenActors.get(token);
    if (!actor) {
        throw new Error("Invalid privileged facade token");
    }
    return actor;
}

export function revokePrivilegedToken(token: PrivilegedFacadeToken): void {
    tokenActors.delete(token);
}
