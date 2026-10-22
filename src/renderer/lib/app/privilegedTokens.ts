import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { PrivilegedActor } from "@shared/types/privileged";

export type FacadeToken = object;
export type PluginFacadeToken = object;
export type PrivilegedFacadeToken = FacadeToken | PluginFacadeToken;

/*
 * ⚠ **Captured while only Studio has run.** Plugin code shares this realm, and every privileged call
 * a plugin makes resolves its actor here. Looked up through the live `WeakMap.prototype.get`, a
 * plugin could replace that one method to answer with Studio's own actor - and main, which only
 * ever sees the actor this module names, would grant it Studio's reach. These references are taken
 * when the module is evaluated, which is before the first plugin module is imported, so nothing a
 * plugin later does to the built-ins changes what they are.
 */
const apply = Reflect.apply;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakMapDelete = WeakMap.prototype.delete;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;

const tokenActors = new WeakMap<object, PrivilegedActor>();

function createToken(actor: PrivilegedActor): object {
    const token = objectFreeze(objectCreate(null)) as object;
    apply(weakMapSet, tokenActors, [token, objectFreeze({ ...actor })]);
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
    const actor = apply(weakMapGet, tokenActors, [token]) as PrivilegedActor | undefined;
    if (!actor) {
        throw new Error("Invalid privileged facade token");
    }
    return actor;
}

export function revokePrivilegedToken(token: PrivilegedFacadeToken): void {
    apply(weakMapDelete, tokenActors, [token]);
}
