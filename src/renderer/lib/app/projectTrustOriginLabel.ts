import type { ProjectTrustOrigin } from "@shared/types/projectTrust";
import type { TranslationKey } from "@shared/i18n";

/**
 * How Studio met a project, as a sentence fragment beside its name.
 *
 * One table for the two windows that show it - the settings list and the trust prompt - so an
 * origin added to the type is labelled once and the compiler says where the label is missing.
 */
export const PROJECT_TRUST_ORIGIN_LABEL: Record<ProjectTrustOrigin, TranslationKey> = {
    package: "settings.data.projectTrust.origin.package",
    remote: "settings.data.projectTrust.origin.remote",
    opened: "settings.data.projectTrust.origin.opened",
    created: "settings.data.projectTrust.origin.created",
    recent: "settings.data.projectTrust.origin.recent",
    "command-line": "settings.data.projectTrust.origin.commandLine",
};
