import { useTranslation } from "@/lib/i18n";
import type { ReactNode } from "react";

/**
 * The project dashboard, as Studio draws one.
 *
 * The surface behind every screen of setup that is not about the story editor. It is the first
 * thing a workspace opens on, it is mostly type at a few sizes, and it holds still - which makes it
 * the honest thing to show while the questions on the left are about language, theme and zoom
 * rather than about rows.
 *
 * Copied from `DashboardTab` and `DashboardPrimitives`: the centred column at `max-w-4xl`, the
 * greeting at `text-xl`, the project under it, the facts in `text-2xs`, and the sections of
 * `label -> number` rows in one bordered card. The numbers are a sample and say so by being round;
 * the words are the dashboard's own catalog keys, so they are in the language the screen is asking
 * about.
 */

/** `DashboardSection`, without the actions slot nothing here fills. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3">
            <header className="flex items-baseline gap-3">
                <h2 className="text-sm font-medium text-fg">{title}</h2>
                {description ? <p className="text-2xs text-fg-subtle">{description}</p> : null}
            </header>
            {children}
        </section>
    );
}

/** `StatList` - one bordered card, two columns where there is room. */
function Stats({ children }: { children: ReactNode }) {
    return (
        <dl className="grid grid-cols-1 gap-x-8 rounded-md border border-edge bg-fill-subtle px-3 py-2 sm:grid-cols-2">
            {children}
        </dl>
    );
}

/** `StatRow` - the label wraps, the number never does. */
function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="min-w-0 text-xs text-fg-muted">{label}</dt>
            <dd className="shrink-0 text-sm font-medium tabular-nums text-fg">{value}</dd>
        </div>
    );
}

export function DashboardPreview() {
    const { t } = useTranslation();

    return (
        <div aria-hidden className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-surface">
            <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-6">
                <header className="flex flex-col gap-1">
                    {/* The greeting the real dashboard picks by the hour. Fixed here: a sample that
                        said "good evening" at ten in the morning would be the one thing on this
                        screen an author could catch out. */}
                    <h1 className="truncate text-xl font-medium text-fg">{t("dashboard.greeting.afternoon")}</h1>
                    <p className="truncate text-sm text-fg-muted">{t("onboarding.sample.projectName")}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-fg-subtle">
                        <span>{t("dashboard.header.lastActive")} {t("onboarding.sample.dashboard.lastActive")}</span>
                        <span>{t("dashboard.header.trackedSince")} {t("onboarding.sample.dashboard.trackedSince")}</span>
                    </div>
                </header>

                <Section title={t("dashboard.scale.title")}>
                    <Stats>
                        <Stat label={t("dashboard.scale.scenes")} value="12" />
                        <Stat label={t("dashboard.scale.dialogueLines")} value="480" />
                        <Stat label={t("dashboard.scale.totalWords")} value="9,600" />
                        <Stat label={t("dashboard.scale.characters")} value="4" />
                        <Stat label={t("dashboard.scale.assets")} value="86" />
                        <Stat label={t("dashboard.scale.uiSurfaces")} value="6" />
                    </Stats>
                </Section>

                <Section title={t("dashboard.activity.title")} description={t("dashboard.activity.description")}>
                    <Stats>
                        <Stat label={t("dashboard.activity.edits")} value="214" />
                        <Stat label={t("dashboard.scale.variables")} value="18" />
                    </Stats>
                </Section>
            </div>
        </div>
    );
}
