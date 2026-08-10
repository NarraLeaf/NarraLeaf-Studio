import { useCallback, useMemo, useState } from "react";
import type { HelpTopicId } from "@/lib/help";
import { NavigationLayout, Sidebar, LauncherTabKey } from "./components";
import { ProjectsTab } from "./tabs/ProjectsTab";
import { PluginsTab } from "./tabs/PluginsTab";
import { LearningTab } from "./tabs/LearningTab";
import { OnboardingFlow, useOnboardingMode } from "./onboarding";
import { useLauncherMenuActions } from "./useLauncherMenuActions";

export function LauncherApp() {
    const [active, setActive] = useState<LauncherTabKey>("projects");
    // Only ever set by leaving setup on one of its three links. Cleared the moment the author picks
    // a tab themselves, so the Learning tab opens where it always did unless this particular trip
    // asked for a topic.
    const [learningTopic, setLearningTopic] = useState<HelpTopicId>();
    // Decided by the main process and carried on this window's props, so the first frame is
    // already the right one - see `useOnboardingMode`.
    const { mode, finish } = useOnboardingMode();

    useLauncherMenuActions();

    const selectTab = useCallback((key: LauncherTabKey) => {
        setActive(key);
        setLearningTopic(undefined);
    }, []);

    /**
     * The one way out of setup, with or without somewhere to be put down.
     *
     * `finish` first in both cases: the completion marker is what stops setup being offered again,
     * and it means the same thing whether the author left by the button or by a link.
     */
    const leaveSetup = useCallback((topic?: HelpTopicId) => {
        finish();
        if (topic) {
            setLearningTopic(topic);
            setActive("learning");
        }
    }, [finish]);

    const content = useMemo(() => {
        switch (active) {
            case "projects":
                return <ProjectsTab />;
            case "plugins":
                return <PluginsTab />;
            case "learning":
                return <LearningTab initialTopic={learningTopic} />;
            default:
                return null;
        }
    }, [active, learningTopic]);

    // Nothing until the window has said which it is. One frame of blank beats one frame of the
    // home screen being replaced, which is the flash first-run setup exists to not have.
    if (mode === "unknown") {
        return null;
    }

    if (mode === "setup") {
        return <OnboardingFlow onFinish={leaveSetup} />;
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
