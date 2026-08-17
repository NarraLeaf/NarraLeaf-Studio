/**
 * Project -> Project: the two things that are settings of the project itself
 * rather than of the application it produces or the game inside it.
 *
 * The key the project builds under, then the check a build runs. They are here
 * together because neither is a property of one build: both travel with the
 * project, and both are answered once and then left alone for months.
 */

import { ProjectDistributionSection } from "../sections/ProjectDistributionSection";
import { ProjectLintingSection } from "../sections/ProjectLintingSection";
import type { ProjectSectionProps } from "../sections/types";

export function ProjectProjectPage(props: ProjectSectionProps) {
    return (
        <div className="grid gap-3 [&>*]:min-w-0">
            <ProjectDistributionSection {...props} />
            <ProjectLintingSection {...props} />
        </div>
    );
}
