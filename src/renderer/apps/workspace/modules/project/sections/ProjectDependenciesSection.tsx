import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import type {
    DependencyKind,
    DependencyResolutionEntry,
    DependencyStatus,
    ProjectDependencyResolution,
} from "@shared/types/pluginDependencies";
import type { ProjectSectionProps } from "./types";

const STATUS_STYLES: Record<DependencyStatus, { label: string; dot: string; text: string }> = {
    satisfied: { label: "Ready", dot: "bg-emerald-400", text: "text-emerald-300" },
    outdated: { label: "Outdated", dot: "bg-amber-400", text: "text-amber-300" },
    missing: { label: "Missing", dot: "bg-rose-400", text: "text-rose-300" },
    incompatible: { label: "Incompatible", dot: "bg-rose-400", text: "text-rose-300" },
};

const KIND_LABELS: Record<DependencyKind, [singular: string, plural: string]> = {
    blueprintNode: ["node", "nodes"],
    widget: ["widget", "widgets"],
    storage: ["store", "stores"],
    storyAction: ["action", "actions"],
};

/**
 * Read-only view of the plugins this project depends on, with each plugin's
 * compatibility status against what is installed. Plugins flagged incompatible
 * are disabled for the project; this panel explains why. "Rescan" re-derives the
 * table from current usage and persists it.
 */
export function ProjectDependenciesSection(_props: ProjectSectionProps) {
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
        <div className="grid gap-3">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => void rescan()}
                    disabled={busy}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                    Rescan
                </button>
            </div>

            {resolution && resolution.overall !== "ok" ? (
                <OverallBanner overall={resolution.overall} />
            ) : null}

            {entries.length === 0 ? (
                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4 text-center text-[11px] text-slate-500">
                    {busy ? "Scanning project…" : "No plugin dependencies — this project uses only built-in Studio features."}
                </div>
            ) : (
                <div className="grid gap-2">
                    {entries.map(entry => (
                        <DependencyRow key={entry.dependency.id} entry={entry} />
                    ))}
                </div>
            )}
        </div>
    );
}

function OverallBanner({ overall }: { overall: "warnings" | "blocked" }) {
    const blocked = overall === "blocked";
    return (
        <div
            className={`rounded-md border p-2.5 text-[11px] leading-relaxed ${
                blocked
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"
            }`}
        >
            {blocked
                ? "One or more plugins are disabled for this project because their installed version is incompatible. Update or reinstall them to restore full functionality."
                : "Some dependencies need attention — a plugin is outdated or a soft dependency is unavailable."}
        </div>
    );
}

function DependencyRow({ entry }: { entry: DependencyResolutionEntry }) {
    const { dependency, installedVersion, status, suppressed } = entry;
    const style = STATUS_STYLES[status];
    const usage = summarizeUsage(dependency.usedBy);
    const needsAttention = suppressed || status !== "satisfied";

    const meta = [
        `Requires ${dependency.authoredVersion}`,
        `Installed ${installedVersion ?? "not installed"}`,
        dependency.builtIn ? "Built-in" : null,
        usage,
        !dependency.hard ? "data only" : null,
    ].filter(Boolean).join("  ·  ");

    return (
        <section className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                    <span className="truncate text-sm font-medium text-slate-100">
                        {dependency.name?.trim() || dependency.id}
                    </span>
                </div>
                {needsAttention ? (
                    <span className={`shrink-0 text-[11px] font-medium ${style.text}`}>
                        {suppressed ? "Disabled" : style.label}
                    </span>
                ) : null}
            </div>

            {dependency.publisher?.trim() ? (
                <div className="mt-0.5 truncate pl-3.5 text-[11px] text-slate-500">{dependency.publisher}</div>
            ) : null}
            <div className="mt-1 pl-3.5 text-[11px] text-slate-500">{meta}</div>
        </section>
    );
}

function summarizeUsage(usedBy: Partial<Record<DependencyKind, string[]>>): string | null {
    const parts: string[] = [];
    for (const kind of Object.keys(usedBy) as DependencyKind[]) {
        const count = usedBy[kind]?.length ?? 0;
        if (count > 0) {
            const [singular, plural] = KIND_LABELS[kind];
            parts.push(`${count} ${count === 1 ? singular : plural}`);
        }
    }
    return parts.length > 0 ? parts.join(", ") : null;
}
