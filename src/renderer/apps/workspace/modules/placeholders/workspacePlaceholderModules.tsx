import { BookOpen, Languages } from "lucide-react";
import { PanelComponentProps, PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { WorkspacePlaceholderPanel } from "./WorkspacePlaceholderPanel";

function StoryPanel(_props: PanelComponentProps) {
    return (
        <WorkspacePlaceholderPanel
            title="Story"
            description="Chapters, scenes, and story structure will appear here."
            icon={BookOpen}
        />
    );
}

function LocalizationPanel(_props: PanelComponentProps) {
    return (
        <WorkspacePlaceholderPanel
            title="Localization"
            description="Translation tables and language assets will be managed here."
            icon={Languages}
        />
    );
}

/** Story outline / authoring entry (placeholder). */
export const storyPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:story",
        title: "Story",
        icon: <BookOpen className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -10,
    },
    component: StoryPanel,
};

/** Localization workspace (placeholder). */
export const localizationPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:localization",
        title: "Localization",
        icon: <Languages className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: 25,
    },
    component: LocalizationPanel,
};

