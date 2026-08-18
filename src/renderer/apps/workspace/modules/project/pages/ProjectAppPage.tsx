/**
 * Project -> App: what the application is called, what it looks like in a launcher, and what it
 * needs installed to run.
 *
 * Three parts that used to be three rows in the sidebar. They belong together because they are all
 * answers about *this application* rather than about the game inside it, and because two of them
 * are read far more often than they are written: an author opens this page to check the version
 * they are about to ship or to see whether a plugin is still compatible, not to edit anything.
 */

import { ProjectDetailsSection } from "../sections/ProjectDetailsSection";
import { ProjectAppTagsSection } from "../sections/ProjectAppTagsSection";
import { ProjectUserDataSection } from "../sections/ProjectUserDataSection";
import { ProjectIconsSection } from "../sections/ProjectIconsSection";
import { ProjectDependenciesSection } from "../sections/ProjectDependenciesSection";
import type { ProjectSectionProps } from "../sections/types";

export function ProjectAppPage(props: ProjectSectionProps) {
  return (
    <div className="grid gap-3 [&>*]:min-w-0">
      <ProjectDetailsSection {...props} />
      {/* Directly under the fields it varies: a variant states one of those three or inherits
                it, so the values it is read against are the rows immediately above. */}
      <ProjectAppTagsSection {...props} />
      {/* Also under those fields, for the same reason: the directory a shipped game writes the
                player's files to is named after the identifier, and this is where it is changed. */}
      <ProjectUserDataSection {...props} />
      <ProjectIconsSection {...props} />
      <ProjectDependenciesSection {...props} />
    </div>
  );
}
