import { ChevronRight, Image as ImageIcon, Info, Puzzle, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { InteractiveCard } from "@/lib/components/elements";
import type { ProjectConfig } from "@/lib/workspace/project/project";

export type ProjectSectionId = "details" | "assets" | "settings" | "dependencies";

export type ProjectNavItem = {
    id: ProjectSectionId;
    title: string;
    description: string;
    icon: LucideIcon;
};

export const PROJECT_NAV_ITEMS: ProjectNavItem[] = [
    {
        id: "details",
        title: "Details",
        description: "Name, identifier, and metadata",
        icon: Info,
    },
    {
        id: "assets",
        title: "Assets",
        description: "Application icons for each platform",
        icon: ImageIcon,
    },
    {
        id: "dependencies",
        title: "Dependencies",
        description: "Plugins this project relies on",
        icon: Puzzle,
    },
    {
        id: "settings",
        title: "Settings",
        description: "Networking and packaging behavior",
        icon: SlidersHorizontal,
    },
];

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
    return (
        <div className="flex h-full min-h-0 flex-col bg-[#101114] text-slate-200">
            <div className="border-b border-white/10 p-3">
                <div className="truncate text-sm font-semibold text-slate-100">
                    {config?.name?.trim() || "Untitled project"}
                </div>
                {config?.identifier?.trim() ? (
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">{config.identifier}</div>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="grid gap-2">
                    {PROJECT_NAV_ITEMS.map(item => {
                        const ItemIcon = item.icon;
                        return (
                            <InteractiveCard
                                key={item.id}
                                size="sm"
                                title={item.title}
                                description={item.description}
                                icon={<ItemIcon className="h-4 w-4" />}
                                actions={<ChevronRight className="h-4 w-4 text-slate-500" />}
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
