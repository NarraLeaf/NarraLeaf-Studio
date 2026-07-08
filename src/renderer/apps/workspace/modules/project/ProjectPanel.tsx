import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { PanelComponentProps } from "../types";
import { PROJECT_NAV_ITEMS, ProjectPanelHome, type ProjectSectionId } from "./ProjectPanelHome";
import { ProjectSubPage } from "./components/ProjectSubPage";
import { ProjectDetailsSection } from "./sections/ProjectDetailsSection";
import { ProjectAssetsSection } from "./sections/ProjectAssetsSection";
import { ProjectSettingsSection } from "./sections/ProjectSettingsSection";
import { ProjectDependenciesSection } from "./sections/ProjectDependenciesSection";
import type { ProjectSectionProps } from "./sections/types";

export function ProjectPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const [config, setConfig] = useState<ProjectConfig | null>(null);
    const [activeSection, setActiveSection] = useState<ProjectSectionId | null>(null);

    const projectService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<ProjectService>(Services.Project);
    }, [context, isInitialized]);

    const uiService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context, isInitialized]);

    useEffect(() => {
        if (!projectService) {
            setConfig(null);
            return;
        }
        setConfig(cloneProjectConfig(projectService.getProjectConfig()));
    }, [projectService]);

    const handleConfigChange = useCallback((next: ProjectConfig) => {
        setConfig(cloneProjectConfig(next));
    }, []);

    const closeSection = useCallback(() => setActiveSection(null), []);

    // Escape returns to the overview when a sub-page is open.
    useEffect(() => {
        if (!activeSection) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                setActiveSection(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [activeSection]);

    const activeItem = activeSection
        ? PROJECT_NAV_ITEMS.find(item => item.id === activeSection) ?? null
        : null;

    const sectionProps: ProjectSectionProps | null = useMemo(() => {
        if (!projectService || !config) {
            return null;
        }
        return { projectService, uiService, config, onConfigChange: handleConfigChange };
    }, [config, handleConfigChange, projectService, uiService]);

    return (
        <div
            className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#101114]"
            data-panel-id={panelId}
        >
            <ProjectPanelHome config={config} onOpen={setActiveSection} />

            <AnimatePresence>
                {activeItem && sectionProps ? (
                    <motion.div
                        key={activeItem.id}
                        className="absolute inset-0 z-10 bg-[#101114] shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <ProjectSubPage
                            title={activeItem.title}
                            description={activeItem.description}
                            onBack={closeSection}
                        >
                            {activeItem.id === "details" ? <ProjectDetailsSection {...sectionProps} /> : null}
                            {activeItem.id === "assets" ? <ProjectAssetsSection {...sectionProps} /> : null}
                            {activeItem.id === "dependencies" ? <ProjectDependenciesSection {...sectionProps} /> : null}
                            {activeItem.id === "settings" ? <ProjectSettingsSection {...sectionProps} /> : null}
                        </ProjectSubPage>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

function cloneProjectConfig(config: ProjectConfig): ProjectConfig {
    return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}
