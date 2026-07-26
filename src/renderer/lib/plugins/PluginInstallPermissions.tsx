import { useMemo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { TranslationKey, Translator } from "@shared/i18n";
import type { PluginInstallPermission, PluginRuntimeCapability } from "@shared/types/pluginPermissions";
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
                    {groups.sidecars.map((permission, index) => (
                        <PermissionRow key={`${permission.id}-${index}`} tone="warning">
                            <span className="font-mono text-xs">{permission.id}</span>
                            {permission.platforms.length > 0 ? (
                                <div className="mt-0.5 text-xs text-warning/80">
                                    {t("pluginPermission.permissions.sidecarPlatforms", {
                                        platforms: permission.platforms.join(", "),
                                    })}
                                </div>
                            ) : null}
                        </PermissionRow>
                    ))}
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
