import type {
    PluginFileSystemPermissionMode,
    PluginInstallPermission,
} from "../types/pluginPermissions";

/**
 * How an install permission reads on screen is not here: every word the approval prompt and the
 * plugin details show comes from the `pluginPermission` catalog, rendered by
 * `renderer/lib/plugins/PluginInstallPermissions.tsx`. An English description used to be built in
 * this file, and the Studio group of the prompt showed it verbatim in every language.
 */

/**
 * Whether every permission in `next` is already covered by something the user
 * granted in `granted` — i.e. an update that does not *widen* the blast radius.
 *
 * This is what lets a version bump skip the approval prompt. It is deliberately
 * one-directional and conservative: anything this cannot prove is covered counts
 * as a widening, and the user gets asked again. Dropping a permission is fine;
 * only additions matter.
 */
export function isPermissionSubset(
    next: readonly PluginInstallPermission[] | undefined,
    granted: readonly PluginInstallPermission[] | undefined,
): boolean {
    const wanted = next ?? [];
    const held = granted ?? [];
    return wanted.every(permission => held.some(existing => covers(existing, permission)));
}

/** Whether a granted permission fully subsumes a requested one. */
function covers(granted: PluginInstallPermission, requested: PluginInstallPermission): boolean {
    if (granted.kind !== requested.kind) {
        return false;
    }
    if (granted.kind === "api" && requested.kind === "api") {
        return granted.capability === requested.capability;
    }
    if (granted.kind === "filesystem" && requested.kind === "filesystem") {
        return coversFileSystemMode(granted.mode, requested.mode)
            && coversPath(granted, requested);
    }
    if (granted.kind === "runtime" && requested.kind === "runtime") {
        return granted.capability === requested.capability;
    }
    // Same sidecar/dependency, no new platforms or download hosts. Adding either
    // widens what reaches the player's machine, so it re-prompts.
    //
    // The kind is compared too, and it is not a widening test but an equality one: turning an
    // `executable` into a `node` sidecar keeps the id and the platforms while changing what the
    // author agreed to run, and neither direction is obviously the smaller of the two. A grant
    // recorded before the kind existed carries none, which fails this and asks once more - the
    // conservative answer for a permission whose original prompt could not name it.
    if (granted.kind === "sidecar" && requested.kind === "sidecar") {
        return granted.id === requested.id
            && granted.sidecarKind === requested.sidecarKind
            && requested.platforms.every(platform => granted.platforms.includes(platform));
    }
    if (granted.kind === "buildDependency" && requested.kind === "buildDependency") {
        return granted.id === requested.id
            && requested.hosts.every(host => granted.hosts.includes(host));
    }
    // Every pattern the new version wants must be one the author already approved, compared as the
    // exact declared string. Deliberately NOT "is the new pattern covered by an approved one": that
    // would need this to reason about wildcards, and a subset test that has to decide whether
    // `https://*.example.com/*` swallows `https://a.example.com/x` is a second matcher living next
    // to the real one. String equality here can only ever be conservative - the worst it does is
    // ask the author again about a pattern they would have approved.
    if (granted.kind === "externalLink" && requested.kind === "externalLink") {
        return requested.patterns.every(pattern => granted.patterns.includes(pattern));
    }
    // Exact declared strings, for the reason written just above.
    if (granted.kind === "network" && requested.kind === "network") {
        return requested.patterns.every(pattern => granted.patterns.includes(pattern));
    }
    return false;
}

function coversFileSystemMode(
    granted: PluginFileSystemPermissionMode,
    requested: PluginFileSystemPermissionMode,
): boolean {
    return granted === "readwrite" || granted === requested;
}

/**
 * A non-recursive grant covers only its exact path. A recursive one also covers
 * anything beneath it — compared on normalized `/`-separated segments so
 * `/a/bc` is not mistaken for a child of `/a/b`.
 */
function coversPath(
    granted: Extract<PluginInstallPermission, { kind: "filesystem" }>,
    requested: Extract<PluginInstallPermission, { kind: "filesystem" }>,
): boolean {
    const from = normalizePathSegments(granted.path);
    const to = normalizePathSegments(requested.path);
    if (!granted.recursive) {
        return !requested.recursive && from.join("/") === to.join("/");
    }
    return to.length >= from.length && from.every((segment, index) => segment === to[index]);
}

function normalizePathSegments(value: string): string[] {
    return value.replace(/\\/g, "/").split("/").filter(Boolean);
}
