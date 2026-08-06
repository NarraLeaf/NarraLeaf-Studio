import { useMemo } from "react";
import { AppWindow, Boxes, ChevronRight, Gamepad2, ListChecks, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { InteractiveCard } from "@/lib/components/elements";
import type { ProjectConfig } from "@/lib/workspace/project/project";

export type ProjectSectionId = "app" | "game" | "project" | "runtimes" | "settings";

export type ProjectNavItem = {
    id: ProjectSectionId;
    title: string;
    description: string;
    icon: LucideIcon;
};

const PROJECT_NAV_ICONS: Record<ProjectSectionId, LucideIcon> = {
    app: AppWindow,
    game: Gamepad2,
    project: ListChecks,
    runtimes: Boxes,
    settings: SlidersHorizontal,
};

// Five rows, where there were nine. The nine were one row per surface, and the surfaces had grown
// out of each other: Details and Assets both answered "what is this application called and what
// does it look like in a launcher", Game and Preferences both answered "what does the player get",
// and a reader had to open three of them to find out where a volume is set. Each row here is a
// question an author actually arrives with, and the parts inside it are told apart by headings.
//
// The order is how far the answer is from the player. App is the application's own identity, Game
// is what the player meets, Project is what the project is checked against, Runtimes and Settings
// are what it is built with and how it ships.
const PROJECT_NAV_ORDER: ProjectSectionId[] = ["app", "game", "project", "runtimes", "settings"];

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
