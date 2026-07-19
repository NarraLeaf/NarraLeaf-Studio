import { BookOpen, ExternalLink, FileText, FlaskConical } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import {
    LEARNING_RESOURCES,
    type LearningResource,
    type LearningResourceCategory,
} from "./learningResources";

const CATEGORY_ORDER: readonly LearningResourceCategory[] = ["tutorials", "examples", "docs"];

const CATEGORY_META: Record<LearningResourceCategory, { titleKey: TranslationKey; icon: React.ReactNode }> = {
    tutorials: {
        titleKey: "launcher.learning.categories.tutorials" as TranslationKey,
        icon: <BookOpen className="w-4 h-4 text-fg-muted" />,
    },
    examples: {
        titleKey: "launcher.learning.categories.examples" as TranslationKey,
        icon: <FlaskConical className="w-4 h-4 text-fg-muted" />,
    },
    docs: {
        titleKey: "launcher.learning.categories.docs" as TranslationKey,
        icon: <FileText className="w-4 h-4 text-fg-muted" />,
    },
};

function ResourceCard({ resource, icon }: { resource: LearningResource; icon: React.ReactNode }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={() => void getInterface().app.openExternal(resource.url)}
            title={t("launcher.learning.openInBrowser", { name: resource.title })}
            className="group relative w-full rounded-md bg-fill-subtle p-3 text-left transition-colors hover:bg-fill cursor-default"
        >
            <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-fill">
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{resource.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-fg-subtle">
                        {resource.description}
                    </div>
                </div>
                <ExternalLink className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
        </button>
    );
}

/**
 * Learning tab: a static resource card wall (tutorials / examples / docs) driven by the local
 * data file `learningResources.ts`. Cards open their link in the system browser; empty
 * categories are simply not rendered, so the page grows as content lands.
 */
export function LearningTab() {
    const { t } = useTranslation();

    return (
        <div className="h-full w-full overflow-y-auto pt-6 px-8 pb-8 text-fg">
            <div className="mb-1 text-lg font-semibold">{t("launcher.nav.learning")}</div>
            <div className="mb-6 text-sm text-fg-muted">{t("launcher.learning.hint")}</div>

            {CATEGORY_ORDER.map(category => {
                const resources = LEARNING_RESOURCES.filter(resource => resource.category === category);
                if (resources.length === 0) {
                    return null;
                }
                const meta = CATEGORY_META[category];
                return (
                    <section key={category} className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-muted">
                            {meta.icon}
                            <span>{t(meta.titleKey)}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {resources.map(resource => (
                                <ResourceCard key={resource.id} resource={resource} icon={meta.icon} />
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
