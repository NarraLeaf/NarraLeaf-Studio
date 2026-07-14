import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";

/**
 * Common props handed to every project sub-page section. The parent panel owns
 * the canonical `config` and re-broadcasts it through `onConfigChange` whenever
 * a section persists a change, so sibling views (and the overview header) stay
 * in sync.
 */
export type ProjectSectionProps = {
    projectService: ProjectService;
    uiService: UIService | null;
    config: ProjectConfig;
    onConfigChange: (next: ProjectConfig) => void;
};
