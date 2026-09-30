/**
 * Project -> Settings -> Signing: which credential signs each platform, and the form that puts one
 * on this machine.
 *
 * On the Settings page rather than the App page because signing is a shipping question, like the
 * network policy and asset protection it sits beside: none of them changes what the player meets,
 * all of them change what leaves the machine. The App page answers "what is this application
 * called"; this answers "who does it say it came from".
 *
 * It is here at all - rather than only in the build dialog, where it used to live - because
 * obtaining a certificate is preparation. It is bought, exported and imported days before the build
 * that uses it, and a form reachable only from a dialog called "Build for distribution" is a form
 * nobody opens until they are already trying to ship. The dialog keeps a read-only mirror.
 *
 * The picker and the import form are {@link SigningSection}, shared verbatim with that mirror's
 * file; nothing about the credential UI is written twice.
 */

import { useCallback, useMemo } from "react";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import type { SigningCredential } from "@shared/types/signing";
import {
    normalizeSigningConfiguration,
    SIGNING_PLATFORMS,
    type SigningConfiguration,
} from "@/lib/workspace/project/configuration";
import { SigningSection } from "@/apps/workspace/modules/actions/BuildSigningSection";
import { SettingsGroup } from "../components/SettingsGroup";
import { useConfigSlice } from "./useConfigSlice";
import type { ProjectSectionProps } from "./types";

export function ProjectSigningSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    const stored = useMemo(() => normalizeSigningConfiguration(config.app?.signing), [config.app?.signing]);
    /**
     * Point one platform at a credential, or at nothing.
     *
     * Shown at once and never refused while another platform's choice is still being written - the
     * service lands whole-manifest writes one at a time, each on top of the last, so two choices made
     * back to back are both kept. `undefined` clears the platform: the normalizer drops a blank entry,
     * which is how the project says "build this one unsigned" rather than carrying a deselected id.
     */
    const { value: signing, commit } = useConfigSlice<SigningConfiguration>({
        stored,
        write: patch => projectService.updateSigningConfiguration(patch),
        onConfigChange,
        uiService,
    });

    /**
     * Delete a credential from this machine's vault, once the author has said so.
     *
     * Machine-wide, not project-wide: every project on this computer that names it starts building
     * unsigned. That is what the confirmation says, and why it is a destructive one.
     */
    const removeCredential = useCallback(async (credential: SigningCredential) => {
        if (!uiService) {
            return false;
        }
        const confirmed = await uiService.dialogs.confirmDestructive(
            t("build.signing.removeConfirm", { label: credential.label }),
            t("build.signing.removeConfirmDetail"),
            t("build.signing.removeAction"),
        );
        if (!confirmed) {
            return false;
        }
        const result = await getInterface().signing.remove(credential.id);
        return result.success && result.data.removed;
    }, [t, uiService]);

    return (
        <SettingsGroup
            title={t("project.group.signing")}
            description={t("project.settings.signingDescription")}
            helpTopic="signing"
            trailing={<HelpTrigger topic="signing" />}
        >
            {/* Every signable platform, not the ones some pending build would produce: there is no
                build in flight here, and the point of the page is preparing a certificate for one
                that has not been configured yet. */}
            <SigningSection
                platforms={SIGNING_PLATFORMS}
                signing={signing}
                onChange={(platform, credentialId) => { void commit({ [platform]: credentialId }); }}
                onRemove={removeCredential}
            />
        </SettingsGroup>
    );
}
