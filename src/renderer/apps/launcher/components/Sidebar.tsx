import { BookOpen, FolderOpen, Puzzle, Settings } from "lucide-react";
import { Item } from "./Item";
import { getInterface } from "@/lib/app/bridge";

export type LauncherTabKey = "projects" | "plugins" | "learning";

interface SidebarProps {
    active: LauncherTabKey;
    onChange: (key: LauncherTabKey) => void;
}

function IconProjects() {
    return <FolderOpen className="w-4 h-4" />;
}

function IconPlugins() {
    return <Puzzle className="w-4 h-4" />;
}

function IconLearning() {
    return <BookOpen className="w-4 h-4" />;
}

/**
 * Launcher sidebar with navigation tabs
 * Private component for launcher app only
 */
export function Sidebar({ active, onChange }: SidebarProps) {
    const openSettings = () => {
        getInterface().launchSettings({});
    };

    const navigationItems = [
        {
            key: "projects",
            label: "Projects",
            icon: <IconProjects />,
            active: active === "projects",
            onClick: () => onChange("projects"),
        },
        {
            key: "plugins",
            label: "Plugins",
            icon: <IconPlugins />,
            active: active === "plugins",
            onClick: () => onChange("plugins"),
        },
        {
            key: "learning",
            label: "Learning",
            icon: <IconLearning />,
            active: active === "learning",
            onClick: () => onChange("learning"),
        },
    ];

    return (
        <div className="h-full flex flex-col gap-3 p-3">
            {/* App Info */}
            <div className="flex items-center gap-2 px-2">
                <img src="/favicon.ico" className="w-6 h-6" alt="app" />
                <div className="flex flex-col leading-tight">
                    <span className="text-sm text-white">NarraLeaf Studio</span>
                    <span className="text-[11px] text-gray-400">v0.0.1</span>
                </div>
            </div>
            <div className="border-t border-white/10" />

            {/* Navigation Items */}
            <nav className="flex flex-col gap-1 flex-1">
                {navigationItems.map((item) => (
                    <Item
                        key={item.key}
                        active={item.active}
                        text={item.label}
                        icon={item.icon}
                        onClick={item.onClick}
                    />
                ))}
            </nav>

            {/* Footer */}
            <div className="mt-auto">
                <button
                    className="flex items-center justify-start p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors w-fit cursor-default"
                    onClick={openSettings}
                    title="Settings"
                >
                    <Settings className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
