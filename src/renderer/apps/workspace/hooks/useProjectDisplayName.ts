import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useWorkspace } from "../context";

/**
 * The current project's display name, falling back to the shared "untitled" label when the project
 * has no name yet. Mirrors the derivation the title-bar project switcher uses, so the name shown in
 * the switcher and anywhere else (search placeholder, etc.) always agree.
 */
export function useProjectDisplayName(): string {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const name = context
        ? context.services.get<ProjectService>(Services.Project).getProjectConfig().name
        : "";
    return name?.trim() || t("workspace.shell.projectSwitcher.untitled");
}
