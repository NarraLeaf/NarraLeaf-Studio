import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "../../context";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import { Services } from "@/lib/workspace/services/services";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { PanelComponentProps } from "../types";
import { useProjectNavItems, ProjectPanelHome, type ProjectSectionId } from "./ProjectPanelHome";
import { ProjectSubPage } from "./components/ProjectSubPage";
import { ProjectAppPage } from "./pages/ProjectAppPage";
import { ProjectGamePage } from "./pages/ProjectGamePage";
import { ProjectDesignSection } from "./sections/ProjectDesignSection";
import { ProjectSettingsSection } from "./sections/ProjectSettingsSection";
import { ProjectRuntimesSection } from "./sections/ProjectRuntimesSection";
import { ProjectProjectPage } from "./pages/ProjectProjectPage";
import type { HelpTopicId } from "@/lib/help";
import type { ProjectSectionProps } from "./sections/types";
import { ProjectPartRevealContext } from "./components/SettingsGroup";
import { REVEAL_MARK_MS } from "@/apps/workspace/components/ui/useTableRowReveal";

/** Deep-link payload: open the panel already showing a sub-page. */
export type ProjectPanelPayload = {
    section?: ProjectSectionId;
    /**
     * A part of that sub-page to scroll into view and mark: the `part` id of one of its
     * `SettingsGroup`s (`fonts` is the Design page's font stack).
     */
    part?: string;
};

/**
 * The sub-pages that hold one subject, and the topic that answers for the whole page.
 *
 * The other three are lists of unrelated parts, and a topic on the header would be a `?` that
 * answers about whichever part the author was not looking at.
 */
const SUB_PAGE_HELP_TOPICS: Partial<Record<ProjectSectionId, HelpTopicId>> = {
    design: "brand",
    project: "lint",
    runtimes: "puppetRuntimes",
};

export function ProjectPanel({ panelId, payload }: PanelComponentProps<ProjectPanelPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const [config, setConfig] = useState<ProjectConfig | null>(null);
    const [activeSection, setActiveSection] = useState<ProjectSectionId | null>(null);

    // Depends on the payload OBJECT, not payload.section: the panel is
    // keep-alive, so a user who opens `assets`, backs out to the overview, then
    // asks for `assets` again would see an unchanged section value and no
    // re-open. updatePayload hands us a fresh object each request, which does.
    const [revealedPart, setRevealedPart] = useState<{ part: string; token: number; scrolled: boolean } | null>(null);
    const revealToken = useRef(0);
    useEffect(() => {
        if (payload?.section) {
            setActiveSection(payload.section);
            if (payload.part) {
                revealToken.current += 1;
                setRevealedPart({ part: payload.part, token: revealToken.current, scrolled: false });
            }
        }
    }, [payload]);

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
        // Every manifest write and re-read, whoever made it. The sections read their rows from this
        // config, so a change made elsewhere (the build dialog's switches, a reload after a hand edit)
        // shows here rather than the panel going on showing what it had - and a row that sends a
        // whole map built from what it shows (lint severities, the allowlist) does not send that
        // stale map back.
        return projectService.onConfigChanged(next => setConfig(cloneProjectConfig(next)));
    }, [projectService]);

    const handleConfigChange = useCallback((next: ProjectConfig) => {
        setConfig(cloneProjectConfig(next));
    }, []);

    const closeSection = useCallback(() => setActiveSection(null), []);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // The part a deep link named, brought on screen once the sub-page holding it has drawn it - the
    // page reads the manifest first, so it can be a render or two behind the request.
    useEffect(() => {
        if (!revealedPart || revealedPart.scrolled) {
            return;
        }
        const element = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-project-part]") ?? [])
            .find(candidate => candidate.dataset.projectPart === revealedPart.part);
        if (!element) {
            return;
        }
        element.scrollIntoView({ block: "start" });
        setRevealedPart({ ...revealedPart, scrolled: true });
    });
    const revealedPartToken = revealedPart?.token ?? null;
    useEffect(() => {
        if (revealedPartToken === null) {
            return;
        }
        const timer = window.setTimeout(() => {
            setRevealedPart(current => (current?.token === revealedPartToken ? null : current));
        }, REVEAL_MARK_MS);
        return () => window.clearTimeout(timer);
    }, [revealedPartToken]);

    // Escape returns to the overview when a sub-page is open - unless the key was meant for
    // something else (see `escapeLeavesSubPage`).
    useEffect(() => {
        if (!activeSection) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || isImeKeyEvent(event)) {
                return;
            }
            if (!escapeLeavesSubPage(event.target, rootRef.current)) {
                return;
            }
            event.stopPropagation();
            setActiveSection(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [activeSection]);

    const navItems = useProjectNavItems();
    const activeItem = activeSection
        ? navItems.find(item => item.id === activeSection) ?? null
        : null;

    const sectionProps: ProjectSectionProps | null = useMemo(() => {
        if (!projectService || !config) {
            return null;
        }
        return { projectService, uiService, config, onConfigChange: handleConfigChange };
    }, [config, handleConfigChange, projectService, uiService]);

    return (
        <div
            ref={rootRef}
            className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface"
            data-panel-id={panelId}
        >
            <ProjectPanelHome config={config} onOpen={setActiveSection} />

            <AnimatePresence>
                {activeItem && sectionProps ? (
                    <motion.div
                        key={activeItem.id}
                        // `.nl-opaque-surface`, not `bg-surface`: this slides over the overview list,
                        // which stays mounted underneath, so its fill has to survive the wallpaper
                        // rule that clears every base surface (see styles.css). Same colour either way.
                        className="absolute inset-0 z-10 nl-opaque-surface shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <ProjectPartRevealContext.Provider value={revealedPart?.part ?? null}>
                        <ProjectSubPage
                            title={activeItem.title}
                            description={activeItem.description}
                            // Only the three pages that are one subject from top to bottom. Brand
                            // carries two headings but one subject, so the topic answers for both.
                            // App, Game and Settings each hold several, and those tag themselves.
                            helpTopic={SUB_PAGE_HELP_TOPICS[activeItem.id]}
                            onBack={closeSection}
                        >
                            {activeItem.id === "app" ? <ProjectAppPage {...sectionProps} /> : null}
                            {activeItem.id === "game" ? <ProjectGamePage {...sectionProps} /> : null}
                            {/* Brand is two parts of one subject and names them itself: the
                                colours an author decides, and the slots that follow them. */}
                            {activeItem.id === "design" ? <ProjectDesignSection {...sectionProps} /> : null}
                            {/* Project holds two parts - the key the project is built under, and
                                the check a build runs - so both name themselves. Runtimes still
                                holds one and carries no heading of its own. */}
                            {activeItem.id === "project" ? <ProjectProjectPage {...sectionProps} /> : null}
                            {activeItem.id === "runtimes" ? <ProjectRuntimesSection {...sectionProps} /> : null}
                            {activeItem.id === "settings" ? <ProjectSettingsSection {...sectionProps} /> : null}
                        </ProjectSubPage>
                        </ProjectPartRevealContext.Provider>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}

/**
 * Whether an Escape pressed on `target` is the panel's, to leave the open sub-page with.
 *
 * Not when it was pressed in a field. Escape there abandons the edit (see `NumberField` and
 * `DetailField`), and a key that also left the page took the author away from the field whose edit
 * they had just thrown out - to an overview they had not asked for.
 *
 * Not when it was pressed anywhere outside the panel either: another panel, a dialog or a menu drawn
 * over everything. The listener is on the window, and the panel stays mounted while another tab is
 * in front of it, so without this an Escape that closed a dialog somewhere else also reset this page.
 *
 * With nothing focused the key arrives at the body, and then the page on screen is the one it means.
 */
export function escapeLeavesSubPage(target: EventTarget | null, panelRoot: HTMLElement | null): boolean {
    if (!panelRoot || !(target instanceof Node)) {
        return false;
    }
    if (isEditableKeyboardTarget(target)) {
        return false;
    }
    const doc = panelRoot.ownerDocument;
    if (target === doc.body || target === doc.documentElement) {
        return true;
    }
    return panelRoot.contains(target);
}

function cloneProjectConfig(config: ProjectConfig): ProjectConfig {
    return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}
