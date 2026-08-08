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

import { useCallback, useState } from "react";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import type { SigningCredential, SigningPlatform } from "@shared/types/signing";
import {
    normalizeSigningConfiguration,
    SIGNING_PLATFORMS,
    type SigningConfiguration,
} from "@/lib/workspace/project/configuration";
import { SigningSection } from "@/apps/workspace/modules/actions/BuildSigningSection";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectSigningSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    const [signing, setSigning] = useState<SigningConfiguration>(
        () => normalizeSigningConfiguration(config.app?.signing),
    );
    const [saving, setSaving] = useState(false);

    /**
     * Point one platform at a credential, or at nothing.
     *
     * Optimistic and single-flight, like every other write on this page: `updateSigningConfiguration`
     * is a read-modify-write of the whole manifest, so two in flight together would have the second
     * clobber the first with a copy read before it landed. The row is disabled while one runs rather
     * than the change being dropped, so the picker never shows a choice the project did not take.
     */
    const commit = useCallback(async (platform: SigningPlatform, credentialId: string | undefined) => {
        if (saving) {
            return;
        }
        const previous = signing;
        setSaving(true);
        setSigning(current => ({ ...current, [platform]: credentialId }));
        try {
            // `undefined` clears the platform: the normalizer drops a blank entry, which is how the
            // project says "build this one unsigned" rather than carrying a deselected id.
            const updated = await projectService.updateSigningConfiguration({ [platform]: credentialId });
            setSigning(normalizeSigningConfiguration(updated.app?.signing));
            onConfigChange(updated);
        } catch (error) {
            setSigning(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(false);
        }
    }, [onConfigChange, projectService, saving, signing, uiService]);

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
                busy={saving}
                onChange={(platform, credentialId) => { void commit(platform, credentialId); }}
                onRemove={removeCredential}
            />
        </SettingsGroup>
    );
}
