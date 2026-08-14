import type {
    PluginFileSystemPermissionMode,
    PluginInstallPermission,
    PluginRuntimeCapability,
    PluginSidecarKind,
} from "../types/pluginPermissions";

export const NO_INSTALL_PERMISSIONS_COPY = "No privileged Studio controls are included in this install approval.";

export function describePluginInstallPermissions(permissions: readonly PluginInstallPermission[] | undefined): string[] {
    if (!permissions?.length) {
        return [NO_INSTALL_PERMISSIONS_COPY];
    }

    return permissions.map(describePluginInstallPermission);
}

export function describePluginInstallPermission(permission: PluginInstallPermission): string {
    switch (permission.kind) {
        case "filesystem":
            return `${formatFileSystemMode(permission.mode)} ${permission.recursive ? "inside" : "for"} ${singleLine(permission.path, "declared path")}`;
        case "api":
            return `Use Studio API capability: ${singleLine(permission.capability, "declared capability")}`;
        case "runtime":
            return `In your game: ${describeRuntimeCapability(permission.capability)}`;
        case "sidecar":
            return `${describeSidecarKind(permission.sidecarKind)} (${singleLine(permission.id, "sidecar")}`
                + `${permission.platforms.length > 0 ? `, for ${permission.platforms.join(", ")}` : ""})`;
        case "buildDependency":
            return `Download binaries while building your game (${singleLine(permission.id, "dependency")}`
                + `${permission.hosts.length > 0 ? `, from ${permission.hosts.join(", ")}` : ""})`;
        case "externalLink":
            // The patterns are listed rather than counted: "open 3 addresses" is not something a
            // person can decide about, and the whole value of a declared pattern is that it is
            // readable.
            return "In your game: send the player to "
                + (permission.patterns.length > 0
                    ? permission.patterns.map(pattern => singleLine(pattern, "declared address")).join(", ")
                    : "declared addresses");
        default:
            return exhaustive(permission);
    }
}

/**
 * What the sidecar actually starts. The two are not the same promise, so they do not share a line:
 * a `node` sidecar is not a third-party binary the game launches, it is the plugin's own code with
 * the reach of the game around it.
 *
 * A grant written before the kind was recorded has none, so an unknown value falls back to the
 * looser sentence rather than guessing the lighter of the two.
 */
function describeSidecarKind(kind: PluginSidecarKind): string {
    switch (kind) {
        case "executable":
            return "Ship a separate program and run it with your game";
        case "node":
            return "Ship the plugin's own code and run it as part of your game";
        default:
            return "Ship a program and run it with your game";
    }
}

/**
 * Plain-language stakes for each runtime capability. Deliberately phrased around
 * the player's data rather than the API name: "state.write" means nothing to the
 * person deciding whether to trust the plugin.
 */
function describeRuntimeCapability(capability: PluginRuntimeCapability): string {
    switch (capability) {
        case "store":
            return "store its own data alongside the player's saves";
        case "events":
            return "observe game progress (scenes, dialogue, choices, saves)";
        case "state.read":
            return "read story variables";
        case "state.write":
            return "change story variables";
        case "saves.read":
            return "read the player's save list and metadata";
        case "saves.write":
            return "overwrite the player's saves and load them";
        case "ui.overlay":
            return "draw on top of the game";
        case "assets":
            return "resolve packaged asset URLs";
        case "locale":
            return "read and follow the game language";
        default:
            return capability;
    }
}

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

function formatFileSystemMode(mode: PluginFileSystemPermissionMode): string {
    switch (mode) {
        case "read":
            return "Read access";
        case "write":
            return "Write access";
        case "readwrite":
            return "Read and write access";
        default:
            return mode;
    }
}

function singleLine(value: string, fallback: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized || fallback;
}

function exhaustive(value: never): never {
    throw new Error(`Unsupported plugin install permission: ${JSON.stringify(value)}`);
}
