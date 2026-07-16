import { useMemo } from "react";
import { ChevronRight, Image as ImageIcon, Info, Puzzle, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { InteractiveCard } from "@/lib/components/elements";
import type { ProjectConfig } from "@/lib/workspace/project/project";

export type ProjectSectionId = "details" | "assets" | "settings" | "dependencies";

export type ProjectNavItem = {
    id: ProjectSectionId;
    title: string;
    description: string;
    icon: LucideIcon;
};

const PROJECT_NAV_ICONS: Record<ProjectSectionId, LucideIcon> = {
    details: Info,
    assets: ImageIcon,
    dependencies: Puzzle,
    settings: SlidersHorizontal,
};

const PROJECT_NAV_ORDER: ProjectSectionId[] = ["details", "assets", "dependencies", "settings"];

/**
 * The project navigation rows, with localized title/description. Shared by the
 * overview list and the parent panel (which resolves the active sub-page).
 */
export function useProjectNavItems(): ProjectNavItem[] {
    const { t } = useTranslation();
    return useMemo(
        () => PROJECT_NAV_ORDER.map(id => ({
            id,
            title: t(`project.nav.${id}.title`),
            description: t(`project.nav.${id}.description`),
            icon: PROJECT_NAV_ICONS[id],
        })),
        [t],
    );
}

/**
 * Project overview: a compact identity header plus a list of setting sections.
 * Selecting a row asks the parent panel to slide in the matching sub-page.
 */
export function ProjectPanelHome({
    config,
    onOpen,
}: {
    config: ProjectConfig | null;
    onOpen: (section: ProjectSectionId) => void;
}) {
    const { t } = useTranslation();
    const navItems = useProjectNavItems();
    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <div className="border-b border-edge p-3">
                <div className="truncate text-sm font-semibold text-fg">
                    {config?.name?.trim() || t("project.home.untitledProject")}
                </div>
                {config?.identifier?.trim() ? (
                    <div className="mt-0.5 truncate text-2xs text-fg-subtle">{config.identifier}</div>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="grid gap-2">
                    {navItems.map(item => {
                        const ItemIcon = item.icon;
                        return (
                            <InteractiveCard
                                key={item.id}
                                size="sm"
                                title={item.title}
                                description={item.description}
                                icon={<ItemIcon className="h-4 w-4" />}
                                actions={<ChevronRight className="h-4 w-4 text-fg-subtle" />}
                                onClick={config ? () => onOpen(item.id) : undefined}
                                className="text-left"
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
