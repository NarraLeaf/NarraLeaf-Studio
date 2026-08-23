import { useCallback, useMemo, useState } from "react";
import { NavigationLayout, Sidebar, LauncherTabKey } from "./components";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { forgetServerProject } from "@/lib/vcs/servers";
import { ServersTab } from "./tabs/ServersTab";
import { PluginsTab } from "./tabs/PluginsTab";
import { LearningTab } from "./tabs/LearningTab";
import { OnboardingFlow, useOnboardingMode } from "./onboarding";
import { useLauncherMenuActions } from "./useLauncherMenuActions";

export function LauncherApp() {
    const [active, setActive] = useState<LauncherTabKey>("projects");
    // Decided by the main process and carried on this window's props, so the first frame is
    // already the right one - see `useOnboardingMode`.
    const { mode, finish } = useOnboardingMode();

    useLauncherMenuActions();

    const selectTab = useCallback((key: LauncherTabKey) => {
        setActive(key);
    }, []);

    const content = useMemo(() => {
        switch (active) {
            case "projects":
                return <ProjectsTab />;
            case "servers":
                return <ServersTab onForget={forgetServerProject} />;
            case "plugins":
                return <PluginsTab />;
            case "learning":
                return <LearningTab />;
            default:
                return null;
        }
    }, [active]);

    // Nothing until the window has said which it is. One frame of blank beats one frame of the
    // home screen being replaced, which is the flash first-run setup exists to not have.
    if (mode === "unknown") {
        return null;
    }

    if (mode === "setup") {
        return <OnboardingFlow onFinish={finish} />;
    }

    return (
        <NavigationLayout
            title=""
            iconSrc=""
            navigation={<Sidebar active={active} onChange={selectTab} />}
        >
            {content}
        </NavigationLayout>
    );
}


export default LauncherApp;
