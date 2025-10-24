import { useMemo, useState } from "react";
import { NavigationLayout, Sidebar, LauncherTabKey } from "./components";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { PluginsTab } from "./tabs/PluginsTab";
import { LearningTab } from "./tabs/LearningTab";

export function LauncherApp() {
    const [active, setActive] = useState<LauncherTabKey>("projects");

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
        <NavigationLayout
            title=""
            iconSrc=""
            navigation={<Sidebar active={active} onChange={setActive} />}
        >
            {content}
        </NavigationLayout>
    );
}


