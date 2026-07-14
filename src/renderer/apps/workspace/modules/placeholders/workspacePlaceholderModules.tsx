import { BookOpen, Languages } from "lucide-react";
import { translate, useTranslation } from "@/lib/i18n";
import { PanelComponentProps, PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { WorkspacePlaceholderPanel } from "./WorkspacePlaceholderPanel";

function StoryPanel(_props: PanelComponentProps) {
    const { t } = useTranslation();
    return (
        <WorkspacePlaceholderPanel
            title={t("placeholders.story.title")}
            description={t("placeholders.story.description")}
            icon={BookOpen}
        />
    );
}

function LocalizationPanel(_props: PanelComponentProps) {
    const { t } = useTranslation();
    return (
        <WorkspacePlaceholderPanel
            title={t("placeholders.localization.title")}
            description={t("placeholders.localization.description")}
            icon={Languages}
        />
    );
}

/** Story outline / authoring entry (placeholder). */
export const storyPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:story",
        // Resolved lazily on read (module registration runs after i18n init).
        get title() {
            return translate("placeholders.moduleTitles.story");
        },
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
        // Resolved lazily on read (module registration runs after i18n init).
        get title() {
            return translate("placeholders.moduleTitles.localization");
        },
        icon: <Languages className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: 25,
    },
    component: LocalizationPanel,
};

