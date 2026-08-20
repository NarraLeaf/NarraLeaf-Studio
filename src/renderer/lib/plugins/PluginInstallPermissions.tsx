import { useMemo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { TranslationKey, Translator } from "@shared/i18n";
import type {
    PluginInstallPermission,
    PluginRuntimeCapability,
    PluginSidecarKind,
} from "@shared/types/pluginPermissions";
import { describePluginInstallPermission } from "@shared/utils/pluginInstallPermissions";

type PermissionOf<K extends PluginInstallPermission["kind"]> = Extract<PluginInstallPermission, { kind: K }>;

/**
 * Install permissions split by blast radius rather than by where they were
 * declared. A native binary that ships to every player, a build-time download
 * from a third-party host, an in-game capability, and a Studio API call are four
 * different questions; a flat list asks them as if they were one.
 */
export interface GroupedInstallPermissions {
    sidecars: PermissionOf<"sidecar">[];
    buildDependencies: PermissionOf<"buildDependency">[];
    runtime: PermissionOf<"runtime">[];
    /**
     * Addresses outside the game the plugin may send the player to. Its own group rather than a row
     * under `runtime`, because every other in-game capability acts on things the game already owns
     * - its saves, its variables, its own screen - and this one leaves.
     */
    externalLinks: PermissionOf<"externalLink">[];
    /**
     * Hosts the plugin requests bytes from. Beside {@link externalLinks} rather than inside it:
     * one sends the player somewhere, the other brings data back into the game, and an author who
     * decided about one has not decided about the other.
     */
    network: PermissionOf<"network">[];
    /** Author-declared Studio controls (`filesystem` / `api`), kept in declaration order. */
    studio: (PermissionOf<"filesystem"> | PermissionOf<"api">)[];
}

export function groupInstallPermissions(
    permissions: readonly PluginInstallPermission[] | undefined,
): GroupedInstallPermissions {
    const grouped: GroupedInstallPermissions = {
        sidecars: [],
        buildDependencies: [],
        runtime: [],
        externalLinks: [],
        network: [],
        studio: [],
    };
    for (const permission of permissions ?? []) {
        switch (permission.kind) {
            case "sidecar":
                grouped.sidecars.push(permission);
                break;
            case "buildDependency":
                grouped.buildDependencies.push(permission);
                break;
            case "runtime":
                grouped.runtime.push(permission);
                break;
            case "externalLink":
                grouped.externalLinks.push(permission);
                break;
            case "network":
                grouped.network.push(permission);
                break;
            default:
                grouped.studio.push(permission);
                break;
        }
    }
    return grouped;
}

const RUNTIME_CAPABILITY_KEYS: Record<PluginRuntimeCapability, TranslationKey> = {
    "store": "pluginPermission.permissions.runtimeCapability.store",
    "events": "pluginPermission.permissions.runtimeCapability.events",
    "state.read": "pluginPermission.permissions.runtimeCapability.stateRead",
    "state.write": "pluginPermission.permissions.runtimeCapability.stateWrite",
    "saves.read": "pluginPermission.permissions.runtimeCapability.savesRead",
    "saves.write": "pluginPermission.permissions.runtimeCapability.savesWrite",
    "ui.overlay": "pluginPermission.permissions.runtimeCapability.uiOverlay",
    "assets": "pluginPermission.permissions.runtimeCapability.assets",
    "locale": "pluginPermission.permissions.runtimeCapability.locale",
    "story.compile": "pluginPermission.permissions.runtimeCapability.storyCompile",
};

/**
 * Manifests are validated before they get here, but they arrive from disk and
 * from the registry, so an unknown capability falls back to its raw name rather
 * than rendering as nothing - an unreadable row still says something is granted.
 */
function runtimeCapabilityLabel(capability: PluginRuntimeCapability, t: Translator["t"]): string {
    const key = RUNTIME_CAPABILITY_KEYS[capability];
    return key ? t(key) : capability;
}

const SIDECAR_KIND_KEYS: Record<PluginSidecarKind, TranslationKey> = {
    "executable": "pluginPermission.permissions.sidecarKind.executable",
    "node": "pluginPermission.permissions.sidecarKind.node",
};

/**
 * What the sidecar starts, or `null` when the permission does not say - grants recorded before the
 * kind was carried have none, and inventing "a separate program" for them would put a claim in
 * front of the author that nothing checked. The group heading and its note still stand alone.
 */
function sidecarKindLabel(kind: PluginSidecarKind | undefined, t: Translator["t"]): string | null {
    const key = kind ? SIDECAR_KIND_KEYS[kind] : undefined;
    return key ? t(key) : null;
}

export interface PluginInstallPermissionSectionsProps {
    permissions: readonly PluginInstallPermission[] | undefined;
    /** Rounded boxes for card-like surfaces; square to match the consent dialog's chrome. */
    rounded?: boolean;
    className?: string;
}

/**
 * Renders {@link groupInstallPermissions} heaviest-first. Empty groups render
 * nothing at all - a heading with no rows under it reads as a capability the
 * plugin has, which is exactly backwards.
 */
export function PluginInstallPermissionSections({
    permissions,
    rounded = true,
    className,
}: PluginInstallPermissionSectionsProps) {
    const { t } = useTranslation();
    const groups = useMemo(() => groupInstallPermissions(permissions), [permissions]);

    if (
        !groups.sidecars.length
        && !groups.buildDependencies.length
        && !groups.runtime.length
        && !groups.externalLinks.length
        && !groups.network.length
        && !groups.studio.length
    ) {
        return null;
    }

    return (
        <div className={cn("space-y-3", className)}>
            {groups.sidecars.length > 0 ? (
                <PermissionGroup
                    label={t("pluginPermission.permissions.section.sidecar")}
                    tone="warning"
                    rounded={rounded}
                >
                    <PermissionRow tone="warning">
                        {t("pluginPermission.permissions.section.sidecarNote")}
                    </PermissionRow>
                    {groups.sidecars.map((permission, index) => {
                        const kind = sidecarKindLabel(permission.sidecarKind, t);
                        return (
                            <PermissionRow key={`${permission.id}-${index}`} tone="warning">
                                <span className="font-mono text-xs">{permission.id}</span>
                                {/*
                                  * The kind sits above the platforms because it is the heavier of
                                  * the two lines: where the sidecar runs matters less than whether
                                  * the plugin's own code is what runs.
                                  */}
                                {kind ? (
                                    <div className="mt-0.5 text-xs text-warning/80">{kind}</div>
                                ) : null}
                                {permission.platforms.length > 0 ? (
                                    <div className="mt-0.5 text-xs text-warning/80">
                                        {t("pluginPermission.permissions.sidecarPlatforms", {
                                            platforms: permission.platforms.join(", "),
                                        })}
                                    </div>
                                ) : null}
                            </PermissionRow>
                        );
                    })}
                </PermissionGroup>
            ) : null}

            {groups.buildDependencies.length > 0 ? (
                <PermissionGroup
                    label={t("pluginPermission.permissions.section.buildDependency")}
                    rounded={rounded}
                >
                    {groups.buildDependencies.map((permission, index) => (
                        <PermissionRow key={`${permission.id}-${index}`}>
                            <span className="font-mono text-xs">{permission.id}</span>
                            {permission.hosts.length > 0 ? (
                                <div className="mt-0.5 text-xs text-fg-muted">
                                    {t("pluginPermission.permissions.buildDependencyHosts", {
                                        hosts: permission.hosts.join(", "),
                                    })}
                                </div>
                            ) : null}
                        </PermissionRow>
                    ))}
                </PermissionGroup>
            ) : null}

            {groups.runtime.length > 0 ? (
                <PermissionGroup label={t("pluginPermission.permissions.section.runtime")} rounded={rounded}>
                    {groups.runtime.map((permission, index) => (
                        <PermissionRow key={`${permission.capability}-${index}`}>
                            {runtimeCapabilityLabel(permission.capability, t)}
                        </PermissionRow>
                    ))}
                </PermissionGroup>
            ) : null}

            {groups.externalLinks.length > 0 ? (
                <PermissionGroup
                    label={t("pluginPermission.permissions.section.externalLink")}
                    rounded={rounded}
                >
                    <PermissionRow>
                        {t("pluginPermission.permissions.section.externalLinkNote")}
                    </PermissionRow>
                    {groups.externalLinks.flatMap((permission, groupIndex) => (
                        // One row per pattern, not one row per permission: the patterns are what
                        // the author is agreeing to, and a comma-joined line is a line nobody reads
                        // to the end.
                        permission.patterns.map((pattern, index) => (
                            <PermissionRow key={`${groupIndex}-${index}-${pattern}`}>
                                <span className="font-mono text-xs break-all">{pattern}</span>
                            </PermissionRow>
                        ))
                    ))}
                </PermissionGroup>
            ) : null}

            {groups.network.length > 0 ? (
                <PermissionGroup
                    label={t("pluginPermission.permissions.section.network")}
                    rounded={rounded}
                >
                    <PermissionRow>
                        {t("pluginPermission.permissions.section.networkNote")}
                    </PermissionRow>
                    {groups.network.flatMap((permission, groupIndex) => (
                        // One row per pattern, for the reason the addresses above get one each.
                        permission.patterns.map((pattern, index) => (
                            <PermissionRow key={`${groupIndex}-${index}-${pattern}`}>
                                <span className="font-mono text-xs break-all">{pattern}</span>
                            </PermissionRow>
                        ))
                    ))}
                </PermissionGroup>
            ) : null}

            {groups.studio.length > 0 ? (
                <PermissionGroup label={t("pluginPermission.permissions.section.studio")} rounded={rounded}>
                    {groups.studio.map((permission, index) => (
                        <PermissionRow key={index}>
                            {describePluginInstallPermission(permission)}
                        </PermissionRow>
                    ))}
                </PermissionGroup>
            ) : null}
        </div>
    );
}

function PermissionGroup({
    label,
    tone,
    rounded,
    children,
}: {
    label: string;
    tone?: "warning";
    rounded: boolean;
    children: ReactNode;
}) {
    const warning = tone === "warning";
    return (
        <div>
            <div
                className={cn(
                    "mb-1 flex items-center gap-1 text-2xs font-medium",
                    warning ? "text-warning" : "text-fg-subtle",
                )}
            >
                {warning ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> : null}
                {label}
            </div>
            <div
                className={cn(
                    "border",
                    rounded && "overflow-hidden rounded-md",
                    warning ? "border-warning/25 bg-warning/10" : "border-edge bg-fill-subtle",
                )}
            >
                {children}
            </div>
        </div>
    );
}

function PermissionRow({ tone, children }: { tone?: "warning"; children: ReactNode }) {
    return (
        <div
            className={cn(
                "border-b px-3 py-2 text-sm last:border-b-0",
                tone === "warning" ? "border-warning/20 text-warning" : "border-edge text-fg",
            )}
        >
            {children}
        </div>
    );
}
