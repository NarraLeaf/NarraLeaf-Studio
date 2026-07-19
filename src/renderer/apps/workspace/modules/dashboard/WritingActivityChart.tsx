import { useTranslation } from "@/lib/i18n";
import { formatActivityTooltip, formatDayLabel, type ActivityPoint } from "./dashboardModel";

const CHART_HEIGHT_CLASS = "h-28";
/** Keeps a 1-word day from rendering as an invisible sliver. */
const MIN_BAR_PERCENT = 2;

function ColumnMark({ point, peak }: { point: ActivityPoint; peak: number }) {
    if (point.status === "untracked") {
        return <div className="h-px w-full rounded-full bg-edge" />;
    }
    // The first tracked day has no previous total to subtract, so there is no bar to draw —
    // a marker says "tracking starts here" instead of implying a day of zero writing.
    if (point.status === "start") {
        return (
            <div className="relative h-full w-full">
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 border-l border-dashed border-edge-strong" />
                <div className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-fg-subtle" />
            </div>
        );
    }

    const delta = point.delta ?? 0;
    if (delta < 0) {
        return <div className="h-0.5 w-full rounded-full bg-danger/40" />;
    }
    if (delta === 0) {
        return <div className="h-px w-full rounded-full bg-edge-strong" />;
    }
    const percent = peak > 0 ? (delta / peak) * 100 : 0;
    return (
        <div
            className="w-full rounded-sm bg-primary/60 transition-colors group-hover:bg-primary/90"
            style={{ height: `${Math.max(MIN_BAR_PERCENT, percent)}%` }}
        />
    );
}

export function WritingActivityChart({ points, peak }: { points: readonly ActivityPoint[]; peak: number }) {
    const translator = useTranslation();
    const { t, tn } = translator;

    const first = points[0];
    const last = points[points.length - 1];

    return (
        <div className="flex flex-col gap-1.5">
            <div
                className={`flex ${CHART_HEIGHT_CLASS} w-full items-end gap-px rounded-md border border-edge bg-fill-subtle px-2 py-2`}
                role="img"
                aria-label={t("dashboard.activity.chartLabel")}
            >
                {points.map(point => (
                    <div
                        key={point.key}
                        className="group flex h-full min-w-0 flex-1 items-end justify-center"
                        title={formatActivityTooltip(translator, point)}
                    >
                        <ColumnMark point={point} peak={peak} />
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-between text-2xs text-fg-subtle">
                <span>{first ? formatDayLabel(translator, first.date) : ""}</span>
                <span>
                    {peak > 0
                        ? t("dashboard.activity.peak", { words: tn("dashboard.units.words", peak, { count: peak }) })
                        : ""}
                </span>
                <span>{last ? formatDayLabel(translator, last.date) : ""}</span>
            </div>
        </div>
    );
}
