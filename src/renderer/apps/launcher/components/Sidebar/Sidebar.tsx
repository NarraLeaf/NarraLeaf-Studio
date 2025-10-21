import { getAppInfo } from "@/lib/renderApp";
import { BookOpen, FolderOpen, Puzzle, Settings } from "lucide-react";
import { SidebarItem } from "./SidebarItem";
import { getInterface } from "@/lib/app/bridge";
import { WindowAppType } from "@shared/types/window";

export type SidebarTabKey = "projects" | "plugins" | "learning";

type SidebarProps = {
    active: SidebarTabKey;
    onChange: (key: SidebarTabKey) => void;
};

function IconProjects() {
    return <FolderOpen className="w-4 h-4" />;
}

function IconPlugins() {
    return <Puzzle className="w-4 h-4" />;
}

function IconLearning() {
    return <BookOpen className="w-4 h-4" />;
}

export function Sidebar({ active, onChange }: SidebarProps) {
    const version = getAppInfo().version;

    const openSettings = () => {
        getInterface().launchSettings({});
    }

    return (
        <div className="h-full flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2 px-2">
                <img src="/favicon.ico" className="w-6 h-6" alt="app" />
                <div className="flex flex-col leading-tight">
                    <span className="text-sm text-white">NarraLeaf Studio</span>
                    <span className="text-[11px] text-gray-400">v{version}</span>
                </div>
            </div>
            <div className="border-t border-white/10" />

            <nav className="flex flex-col gap-1 flex-1">
                <SidebarItem
                    active={active === "projects"}
                    text="Projects"
                    icon={<IconProjects />}
                    onClick={() => onChange("projects")}
                />
                <SidebarItem
                    active={active === "plugins"}
                    text="Plugins"
                    icon={<IconPlugins />}
                    onClick={() => onChange("plugins")}
                />
                <SidebarItem
                    active={active === "learning"}
                    text="Learning"
                    icon={<IconLearning />}
                    onClick={() => onChange("learning")}
                />
            </nav>

            {/* Settings icon at bottom left */}
            <div className="mt-auto">
                <button
                    className="flex items-center justify-start p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors w-fit"
                    onClick={openSettings}
                    title="Settings"
                >
                    <Settings className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}


