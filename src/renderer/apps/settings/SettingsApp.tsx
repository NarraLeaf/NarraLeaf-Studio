import { useState } from "react";
import { AppLayout } from "@/lib/components/layout";
import { SettingsGeneralTab } from "./tabs/SettingsGeneralTab";
import { SettingsAppearanceTab } from "./tabs/SettingsAppearanceTab";
import { SettingsEditorTab } from "./tabs/SettingsEditorTab";

export type SettingsTabKey = "general" | "appearance" | "editor";

interface SettingsAppProps {
    initialTab?: SettingsTabKey;
}

/**
 * Settings application with tabbed interface
 * Uses simple AppLayout without sidebar as settings typically don't need navigation
 */
export function SettingsApp({ initialTab = "general" }: SettingsAppProps) {
    const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);

    const tabs = [
        { key: "general" as const, label: "General", component: SettingsGeneralTab },
        { key: "appearance" as const, label: "Appearance", component: SettingsAppearanceTab },
        { key: "editor" as const, label: "Editor", component: SettingsEditorTab },
    ];

    const activeTabConfig = tabs.find(tab => tab.key === activeTab);
    const ActiveComponent = activeTabConfig?.component || SettingsGeneralTab;

    return (
        <AppLayout title="Settings" iconSrc="/favicon.ico">
            <div className="h-full flex flex-col">
                {/* Tab Navigation */}
                <div className="flex items-center gap-1 p-4 border-b border-white/10">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            className={`
                                px-4 py-2 text-sm rounded-md transition-colors cursor-default
                                ${activeTab === tab.key
                                    ? "bg-white/10 text-white"
                                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                                }
                            `}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto">
                    <ActiveComponent />
                </div>
            </div>
        </AppLayout>
    );
}
