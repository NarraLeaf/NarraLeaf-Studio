import React, { useMemo, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar, SidebarTabKey } from "./components/Sidebar/Sidebar";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { PluginsTab } from "./tabs/PluginsTab";
import { LearningTab } from "./tabs/LearningTab";

export function LauncherApp() {
    const [active, setActive] = useState<SidebarTabKey>("projects");

    const content = useMemo(() => {
        switch (active) {
            case "projects":
                return <ProjectsTab />;
            case "plugins":
                return <PluginsTab />;
            case "learning":
                return <LearningTab />;
            default:
                return null;
        }
    }, [active]);

    return (
        <div className="h-screen w-screen text-gray-200 bg-[#0f1115]">
            <div className="grid grid-rows-[40px,1fr] grid-cols-[240px,1fr] h-full">
                <div className="row-[1] col-[1_/_span_2]">
                    <TitleBar title={window.document.title} iconSrc="/favicon.ico" />
                </div>
                <aside className="row-[2] col-[1] border-r border-white/10 bg-white/5">
                    <Sidebar active={active} onChange={setActive} />
                </aside>
                <main className="row-[2] col-[2] overflow-auto">
                    {content}
                </main>
            </div>
        </div>
    );
}


