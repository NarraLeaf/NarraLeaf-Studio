import { Fragment } from "react";
import { ListFilter, Trash2, Download } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { TranslationKey } from "@shared/i18n";

/**
 * The console, as Studio draws one.
 *
 * The other surface an author can ask to see while choosing a zoom, and the one that answers the
 * question differently from the dashboard: it is the densest thing in the product - three columns
 * of `text-2xs` monospace - so it is where a size that reads comfortably on a dashboard turns out
 * to be too small.
 *
 * Copied from `ConsolePanel`: the 36px channel strip with its underline, the three trailing icon
 * buttons, and the `72px 78px 1fr` grid with hairline rules between the columns and one colour per
 * level. The lines are a sample of what a run prints; the level words are the console's own catalog
 * keys, so they follow the interface language.
 */

/** The console's own colours per level, at the opacity it prints them. */
const LEVEL_CLASS: Record<string, string> = {
    info: "text-primary/75",
    success: "text-success/75",
    warning: "text-warning/75",
    error: "text-danger/75",
    verbose: "text-fg-subtle/80",
};

interface SampleLine {
    time: string;
    level: keyof typeof LEVEL_CLASS;
    source?: string;
    messageKey: TranslationKey;
}

const LINES: readonly SampleLine[] = [
    { time: "18:04:02", level: "info", source: "build", messageKey: "onboarding.sample.console.start" },
    { time: "18:04:03", level: "verbose", source: "build", messageKey: "onboarding.sample.console.assets" },
    { time: "18:04:09", level: "warning", source: "lint", messageKey: "onboarding.sample.console.warning" },
    { time: "18:04:11", level: "success", source: "build", messageKey: "onboarding.sample.console.done" },
];

export function ConsolePreview() {
    const { t } = useTranslation();

    return (
        <div aria-hidden className="flex h-full min-h-0 flex-col bg-surface text-fg-muted">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge bg-surface-sunken">
                <div className="flex h-full min-w-0">
                    <span className="relative flex min-w-28 items-center justify-center gap-2 px-4 text-xs text-fg">
                        {t("console.channels.build")}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary/70" />
                    </span>
                    <span className="flex min-w-28 items-center justify-center gap-2 px-4 text-xs text-fg-muted">
                        {t("console.channels.story")}
                    </span>
                </div>
                <div className="flex h-full shrink-0 items-center gap-2 px-2">
                    {[Download, ListFilter, Trash2].map((Icon, index) => (
                        <span
                            key={index}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-edge text-fg-muted"
                        >
                            <Icon className="h-3.5 w-3.5" />
                        </span>
                    ))}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto py-1 font-mono text-2xs leading-relaxed">
                {/* One line at a time rather than a column at a time. The real panel emits each
                    column as its own pass and pins every cell with `gridColumn`/`gridRow`, so a
                    hover can light one cell; a sample has nothing to hover, and three passes
                    without the pins interleave the rows. */}
                <div className="grid min-w-full" style={{ gridTemplateColumns: "72px 78px minmax(0, 1fr)" }}>
                    {LINES.map(line => (
                        <Fragment key={line.time}>
                            <span className="border-r border-edge-subtle px-3 py-0.5 text-fg-subtle">{line.time}</span>
                            <span className={cn("border-r border-edge-subtle px-3 py-0.5", LEVEL_CLASS[line.level])}>
                                {t(`console.level.${line.level}` as TranslationKey)}
                            </span>
                            <span className="whitespace-pre-wrap break-words px-3 py-0.5 text-fg-muted">
                                {line.source ? <span className="text-fg-subtle">[{line.source}] </span> : null}
                                {t(line.messageKey)}
                            </span>
                        </Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
}
