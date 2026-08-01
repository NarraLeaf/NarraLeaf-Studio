import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";

/**
 * The store thumbnail for a plugin, as a `data:` URL, or null while it is on
 * its way / when there is none.
 *
 * Renderers do not fetch remote images, so this asks main, which resolves the
 * address from the index it trusts and keeps the bytes on disk. The module-level
 * map is the second half of "fetch it once": main's cache survives restarts,
 * this one keeps a row that scrolls out and back — or a switch to the Installed
 * segment and back — from making the round trip again.
 */
const resolved = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function load(pluginId: string): Promise<string | null> {
    const existing = pending.get(pluginId);
    if (existing) {
        return existing;
    }
    const request = getInterface().plugins.registryIcon(pluginId)
        .then(result => (result.success ? result.data.icon : null))
        .catch(() => null)
        .then(icon => {
            resolved.set(pluginId, icon);
            pending.delete(pluginId);
            return icon;
        });
    pending.set(pluginId, request);
    return request;
}

/**
 * @param pluginId the store entry to show
 * @param hasIcon whether the index says it has one — when false nothing is
 *   requested at all, so a registry of icon-less plugins costs zero round trips
 */
export function useStoreIcon(pluginId: string, hasIcon: boolean): string | null {
    const [icon, setIcon] = useState<string | null>(() => (hasIcon ? resolved.get(pluginId) ?? null : null));

    useEffect(() => {
        if (!hasIcon) {
            setIcon(null);
            return;
        }
        if (resolved.has(pluginId)) {
            setIcon(resolved.get(pluginId) ?? null);
            return;
        }
        let live = true;
        void load(pluginId).then(next => {
            if (live) {
                setIcon(next);
            }
        });
        return () => {
            live = false;
        };
    }, [pluginId, hasIcon]);

    return icon;
}

/** Forget a plugin's cached thumbnail, so the next render asks main again. */
export function forgetStoreIcon(pluginId: string): void {
    resolved.delete(pluginId);
    pending.delete(pluginId);
}
