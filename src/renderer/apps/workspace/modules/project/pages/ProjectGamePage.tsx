/**
 * Project -> Game: everything the player meets, in the order they meet it.
 *
 * Saving, the values a player's own settings start at, and the mixer those settings' volume sliders
 * land on. They were three sidebar rows, and the split was the problem: "how loud is music" was
 * answered in two of them, one row apart, with nothing on either page saying the other existed.
 * Here the volume defaults sit directly above the buses they scale.
 */

import { ProjectGameSection } from "../sections/ProjectGameSection";
import { ProjectSaveCompatibilitySection } from "../sections/ProjectSaveCompatibilitySection";
import { ProjectPreferencesSection } from "../sections/ProjectPreferencesSection";
import { ProjectAudioSection } from "../sections/ProjectAudioSection";
import type { ProjectSectionProps } from "../sections/types";

export function ProjectGamePage(props: ProjectSectionProps) {
    return (
        <div className="grid gap-3 [&>*]:min-w-0">
            <ProjectGameSection {...props} />
            <ProjectSaveCompatibilitySection {...props} />
            <ProjectPreferencesSection {...props} />
            <ProjectAudioSection {...props} />
        </div>
    );
}
