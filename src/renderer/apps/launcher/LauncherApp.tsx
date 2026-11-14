import { useCallback, useEffect, useMemo, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { TeamDeepLink } from "@shared/utils/teamDeepLink";
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

    // A `narraleaf://` link: the one that opened this window, then any that arrive while it is
    // up. Each lands on the Servers tab, which decides what it may do with it.
    const [deepLink, setDeepLink] = useState<{ link: TeamDeepLink; at: number } | null>(null);
    useEffect(() => {
        const take = (link: TeamDeepLink | null) => {
            if (link === null) return;
            setDeepLink({ link, at: Date.now() });
            setActive("servers");
        };
        void getInterface().app.takeDeepLink()
            .then(answer => take(answer.success ? answer.data.link : null))
            .catch(() => undefined);
        const token = getInterface().app.onDeepLink(({ link }) => take(link));
        return () => token.cancel();
    }, []);

    const selectTab = useCallback((key: LauncherTabKey) => {
        setActive(key);
    }, []);

    const content = useMemo(() => {
        switch (active) {
            case "projects":
                return <ProjectsTab />;
            case "servers":
                return <ServersTab onForget={forgetServerProject} deepLink={deepLink} />;
            case "plugins":
                return <PluginsTab />;
            case "learning":
                return <LearningTab />;
            default:
                return null;
        }
    }, [active, deepLink]);

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
