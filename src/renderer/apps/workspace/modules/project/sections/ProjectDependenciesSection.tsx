import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import type { PluralKey, Translator } from "@shared/i18n";
import type {
    DependencyKind,
    DependencyResolutionEntry,
    ProjectDependencyResolution,
} from "@shared/types/pluginDependencies";
import {
    DEPENDENCY_STATUS_LABEL_KEYS,
    DEPENDENCY_STATUS_TEXT_STYLES,
    dependencyNeedsAttention,
} from "@/lib/workspace/project/dependencyStatusDisplay";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

const USAGE_KEYS: Record<DependencyKind, PluralKey> = {
    blueprintNode: "project.dependencies.usage.blueprintNode",
    widget: "project.dependencies.usage.widget",
    storage: "project.dependencies.usage.storage",
    storyAction: "project.dependencies.usage.storyAction",
};

/**
 * Read-only view of the plugins this project depends on, with each plugin's
 * compatibility status against what is installed. Plugins flagged incompatible
 * are disabled for the project; this panel explains why. "Rescan" re-derives the
 * table from current usage and persists it.
 */
export function ProjectDependenciesSection(_props: ProjectSectionProps) {
    const { t } = useTranslation();
    // The on-open resolve is a preview and writes no manifest, so the table stays live while frozen;
    // Rescan is the one that persists.
    const freeze = useFreezeGuard();
    const { context } = useWorkspace();
    const service = useMemo(
        () => context?.services.get<ProjectDependencyService>(Services.ProjectDependency) ?? null,
        [context],
    );

    const [resolution, setResolution] = useState<ProjectDependencyResolution | null>(
        () => service?.getResolution() ?? null,
    );
    const [busy, setBusy] = useState(false);

    // Show a live preview on open (no manifest write), and keep in sync with
    // resolution changes triggered elsewhere (e.g. a rescan-on-export).
    useEffect(() => {
        if (!service) {
            return;
        }
        let active = true;
        setBusy(true);
        service.previewResolve()
            .then(next => { if (active) setResolution(next); })
            .catch(() => { if (active) setResolution(service.getResolution()); })
            .finally(() => { if (active) setBusy(false); });
        const off = service.onResolutionChanged(() => {
            if (active) setResolution(service.getResolution());
        });
        return () => { active = false; off(); };
    }, [service]);

    const rescan = useCallback(async () => {
        if (!service || busy) {
            return;
        }
        setBusy(true);
        try {
            setResolution(await service.rescanAndPersist());
        } finally {
            setBusy(false);
        }
    }, [service, busy]);

    const entries = resolution?.entries ?? [];

    return (
        <SettingsGroup
            // No `?` beside the Rescan button: the row already carries a control, and a second
            // glyph next to it is the row of identical question marks the popover exists to avoid.
            // `F1` over the part still answers.
            helpTopic="plugins"
            title={t("project.group.dependencies")}
            trailing={(
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void rescan()}
                    {...freeze.writes(busy)}
                    className="gap-1.5 px-1.5"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                    {t("project.dependencies.rescan")}
                </Button>
            )}
        >
            {resolution && resolution.overall !== "ok" ? (
                <OverallBanner overall={resolution.overall} />
            ) : null}

            {entries.length === 0 ? (
                <div className="rounded-md border border-edge bg-fill-subtle p-4 text-center text-2xs text-fg-subtle">
                    {busy ? t("project.dependencies.scanning") : t("project.dependencies.empty")}
                </div>
            ) : (
                <div className="grid gap-2">
                    {entries.map(entry => (
                        <DependencyRow key={entry.dependency.id} entry={entry} />
                    ))}
                </div>
            )}
        </SettingsGroup>
    );
}

function OverallBanner({ overall }: { overall: "warnings" | "blocked" }) {
    const { t } = useTranslation();
    const blocked = overall === "blocked";
    return (
        <div
            className={`rounded-md border p-2.5 text-2xs leading-relaxed ${
                blocked
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : "border-warning/30 bg-warning/10 text-warning"
            }`}
        >
            {blocked
                ? t("project.dependencies.banner.blocked")
                : t("project.dependencies.banner.warnings")}
        </div>
    );
}

function DependencyRow({ entry }: { entry: DependencyResolutionEntry }) {
    const { t, tn } = useTranslation();
    const { dependency, installedVersion, status, suppressed } = entry;
    const usage = summarizeUsage(dependency.usedBy, tn);
    const needsAttention = dependencyNeedsAttention(status, suppressed);

    const meta = [
        t("project.dependencies.meta.requires", { version: dependency.authoredVersion }),
        t("project.dependencies.meta.installed", { version: installedVersion ?? t("project.dependencies.meta.notInstalled") }),
        dependency.builtIn ? t("project.dependencies.meta.builtIn") : null,
        usage,
        !dependency.hard ? t("project.dependencies.meta.dataOnly") : null,
    ].filter(Boolean).join("  ·  ");

    return (
        <section className="rounded-md border border-edge bg-fill-subtle p-3">
            <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-fg">
                    {dependency.name?.trim() || dependency.id}
                </span>
                {needsAttention ? (
                    <span className={`shrink-0 text-2xs font-medium ${DEPENDENCY_STATUS_TEXT_STYLES[status]}`}>
                        {suppressed ? t("project.dependencies.status.disabled") : t(DEPENDENCY_STATUS_LABEL_KEYS[status])}
                    </span>
                ) : null}
            </div>

            {dependency.publisher?.trim() ? (
                <div className="mt-0.5 truncate text-2xs text-fg-subtle">{dependency.publisher}</div>
            ) : null}
            <div className="mt-1 text-2xs text-fg-subtle">{meta}</div>
        </section>
    );
}

function summarizeUsage(
    usedBy: Partial<Record<DependencyKind, string[]>>,
    tn: Translator["tn"],
): string | null {
    const parts: string[] = [];
    for (const kind of Object.keys(usedBy) as DependencyKind[]) {
        const count = usedBy[kind]?.length ?? 0;
        if (count > 0) {
            parts.push(tn(USAGE_KEYS[kind], count));
        }
    }
    return parts.length > 0 ? parts.join(", ") : null;
}
