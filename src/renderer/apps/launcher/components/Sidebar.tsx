import { BookOpen, FolderOpen, Puzzle, Settings } from "lucide-react";
import { Item } from "./Item";
import { getInterface } from "@/lib/app/bridge";
import { useUpdateState } from "@/lib/app/useUpdateState";
import { getAppInfo } from "@/lib/renderApp";
import { useTranslation } from "@/lib/i18n";
import { UPDATE_PANEL_SETTING_KEY } from "@shared/constants/update";

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
    const { t } = useTranslation();
    const update = useUpdateState();

    const openSettings = () => {
        getInterface().app.launchSettings({});
    };

    /**
     * The launcher's whole update surface: one line under the version number, and only when there
     * is something to say. It opens the Settings panel - it does not start a download, which is a
     * decision that belongs on the panel with the size and the progress in front of the reader.
     *
     * "ready" is included because an installer already on disk is still news: it needs a restart.
     */
    const updateOffer = update
        && (update.status === "available" || update.status === "manual" || update.status === "ready")
        && update.availableVersion
        ? update.availableVersion
        : null;

    const navigationItems = [
        {
            key: "projects",
            label: t("launcher.nav.projects"),
            icon: <IconProjects />,
            active: active === "projects",
            onClick: () => onChange("projects"),
        },
        {
            key: "plugins",
            label: t("launcher.nav.plugins"),
            icon: <IconPlugins />,
            active: active === "plugins",
            onClick: () => onChange("plugins"),
        },
        {
            key: "learning",
            label: t("launcher.nav.learning"),
            icon: <IconLearning />,
            active: active === "learning",
            onClick: () => onChange("learning"),
        },
    ];

    return (
        <div className="h-full flex flex-col gap-3 p-3">
            {/* App Info */}
            <div className="flex items-center gap-2 px-2 py-3">
                <img src="/favicon.ico" className="w-6 h-6" alt="app" />
                <div className="flex flex-col leading-tight">
                    <span className="text-sm text-fg">NarraLeaf Studio</span>
                    {updateOffer ? (
                        <button
                            className="w-fit text-2xs text-primary hover:underline cursor-default"
                            onClick={() => getInterface().app.launchSettings({ highlight: UPDATE_PANEL_SETTING_KEY })}
                        >
                            {t("update.launcher.available", { version: updateOffer })}
                        </button>
                    ) : (
                        <span className="text-2xs text-fg-muted">v{getAppInfo().version}</span>
                    )}
                </div>
            </div>
            <div className="border-t border-edge" />

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
                    className="flex items-center justify-start p-2 text-fg-muted hover:text-fg hover:bg-fill rounded-md transition-colors w-fit cursor-default"
                    onClick={openSettings}
                    title={t("launcher.nav.settings")}
                >
                    <Settings className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
