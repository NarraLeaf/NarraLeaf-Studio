import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  Accordion,
  AccordionItem,
  Input,
  InputGroup,
  Select,
  TextArea
} from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import type { VcsAvailability } from "@shared/types/vcs";
import { versionControlOptions } from "../constants";
import {
  ProjectData,
  DirectoryValidationResult,
  ValidationErrors,
  VersionControlChoice
} from "../types";

interface ProjectStepProps {
  projectData: ProjectData;
  updateProjectData: (updates: Partial<ProjectData>) => void;
  updateProjectName: (name: string) => void;
  updateAppId: (appId: string) => void;
  validationErrors: ValidationErrors;
  directoryValidation: DirectoryValidationResult | null;
  isValidatingDirectory: boolean;
  onLocationChange: (value: string) => void;
  onLocationBlur: () => Promise<void>;
  onLocationFocus: () => void;
  onSelectDirectory: () => Promise<void>;
  isSelectingDirectory: boolean;
}

/**
 * What the project is called, where it goes, and whether it is versioned.
 *
 * **The four fields that cannot be taken back, on one page.** The app id is frozen the moment the
 * project exists (the project panel shows it under a padlock), the folder is where the files land,
 * and version control decides whether the first revision records the project as created or the
 * project as it looked whenever somebody remembered. Name is here because the other three are
 * derived from it.
 *
 * Everything under "more details" is the opposite: every one of those is a field the project panel
 * edits at any time, and none of them changes what pressing Create does. They are offered because
 * typing them now is cheaper than going to find them later - not because the wizard needs them.
 */
export function ProjectStep({
  projectData,
  updateProjectData,
  updateProjectName,
  updateAppId,
  validationErrors,
  directoryValidation,
  isValidatingDirectory,
  onLocationChange,
  onLocationBlur,
  onLocationFocus,
  onSelectDirectory,
  isSelectingDirectory
}: ProjectStepProps) {
  const { t } = useTranslation();
  const [appIdError, setAppIdError] = useState("");
  const vcsAvailability = useVcsAvailability();
  // Absent while the probe is in flight, which is the honest state: neither "available" nor
  // "not". Offering Lore before the answer arrives and withdrawing it a moment later is worse
  // than a field that is briefly short one option.
  const loreOffered = vcsAvailability?.available === true;
  const localizedVersionControlOptions = versionControlOptions
    // Removed rather than shown disabled: `Select` has no per-option disabled state, and a
    // choice that cannot be taken is not information the author of a new project needs -
    // the line under the field says why it is missing.
    .filter((option) => option.value !== "lore" || loreOffered)
    .map((option) => ({
      ...option,
      label: option.labelKey ? t(option.labelKey) : option.label
    }));

  // Nobody can create a Lore repository on this host, so the field must not be left saying it
  // will. Written back into the wizard's own data instead of only being displayed as `none`,
  // because `ProjectService.createProject` reads that data and not this render.
  useEffect(() => {
    if (vcsAvailability && !vcsAvailability.available && projectData.versionControl !== "none") {
      updateProjectData({ versionControl: "none" });
    }
  }, [vcsAvailability, projectData.versionControl, updateProjectData]);

  const handleAppIdChange = (value: string) => {
    updateAppId(value);
    if (value.trim() === "") {
      setAppIdError(t("wizard.project.appIdRequired"));
    } else if (!/^[a-z0-9-]+$/.test(value)) {
      setAppIdError(t("wizard.project.appIdInvalid"));
    } else {
      setAppIdError("");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-xl space-y-4">
        <InputGroup label={t("wizard.project.name")} required>
          <Input
            autoFocus
            placeholder={t("wizard.project.namePlaceholder")}
            value={projectData.name}
            onChange={(event) => updateProjectName(event.target.value)}
          />
        </InputGroup>

        <InputGroup
          label={t("wizard.fields.appId")}
          required
          error={appIdError}
          helper={t("wizard.project.appIdHelper")}
        >
          <Input
            placeholder={t("wizard.project.appIdPlaceholder")}
            value={projectData.appId}
            onChange={(event) => handleAppIdChange(event.target.value)}
            variant={appIdError ? "error" : "default"}
            pattern="[a-z0-9-]*"
          />
        </InputGroup>

        <InputGroup
          label={t("wizard.fields.location")}
          required
          error={validationErrors.location || validationErrors.directory}
          helper={
            isValidatingDirectory
              ? t("wizard.project.validatingDirectory")
              : directoryValidation && !directoryValidation.exists
                ? t("wizard.project.directoryWillBeCreated")
                : undefined
          }
        >
          <Input
            placeholder={t("wizard.project.locationPlaceholder")}
            value={projectData.location}
            onChange={(event) => onLocationChange(event.target.value)}
            onBlur={onLocationBlur}
            onFocus={onLocationFocus}
            disabled={isValidatingDirectory}
            rightIcon={<FolderOpen className="h-4 w-4" />}
            rightIconLabel={t("wizard.project.browseLocation")}
            onRightIconClick={() => {
              if (!isSelectingDirectory && !isValidatingDirectory) {
                void onSelectDirectory();
              }
            }}
          />
        </InputGroup>

        <InputGroup
          label={t("wizard.fields.versionControl")}
          helper={
            vcsAvailability && !vcsAvailability.available
              ? t(
                  vcsAvailability.reason === "unsupported-platform"
                    ? "wizard.project.versionControlUnavailablePlatform"
                    : "wizard.project.versionControlUnavailableInstallation"
                )
              : projectData.versionControl === "lore"
                ? t("wizard.project.versionControlLoreHint")
                : undefined
          }
        >
          <Select
            options={localizedVersionControlOptions}
            value={projectData.versionControl}
            onChange={(value) =>
              updateProjectData({ versionControl: value as VersionControlChoice })
            }
            fullWidth
            ariaLabel={t("wizard.fields.versionControl")}
          />
        </InputGroup>

        <Accordion className="pt-1">
          <AccordionItem id="more" title={t("wizard.project.moreDetails")}>
            <div className="space-y-4 pb-1 pt-2">
              <InputGroup
                label={t("wizard.fields.version")}
                helper={t("wizard.project.versionHelper")}
              >
                <Input
                  placeholder="1.0.0"
                  value={projectData.version}
                  onChange={(event) => updateProjectData({ version: event.target.value })}
                />
              </InputGroup>

              <InputGroup label={t("wizard.fields.author")}>
                <Input
                  placeholder={t("wizard.project.authorPlaceholder")}
                  value={projectData.author}
                  onChange={(event) => updateProjectData({ author: event.target.value })}
                />
              </InputGroup>

              <InputGroup label={t("wizard.fields.website")}>
                <Input
                  placeholder="https://example.com"
                  value={projectData.website}
                  onChange={(event) => updateProjectData({ website: event.target.value })}
                />
              </InputGroup>

              <InputGroup label={t("common.description")}>
                <TextArea
                  placeholder={t("wizard.project.descriptionPlaceholder")}
                  value={projectData.description}
                  onChange={(event) => updateProjectData({ description: event.target.value })}
                  rows={3}
                  fullWidth
                />
              </InputGroup>
            </div>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}

/**
 * Whether this machine can create a Lore repository at all.
 *
 * Asked because version control is an OPTIONAL capability - Epic ships no native build for macOS
 * Intel or Windows ARM64 - and "unavailable" is a normal answer with a reason rather than an
 * error. Without this the wizard would offer, and pre-select, a choice whose only outcome on those
 * hosts is a failed `initRepository` after the project directory has already been written.
 *
 * `null` until the probe answers. A failed IPC call is treated as unavailable rather than left
 * pending: the alternative is a field stuck one option short with nothing said about why.
 */
function useVcsAvailability(): VcsAvailability | null {
  const [availability, setAvailability] = useState<VcsAvailability | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await getInterface().vcs.getAvailability();
        if (!alive) return;
        setAvailability(
          result.success
            ? result.data
            : { available: false, reason: "backend-load-failed", detail: result.error }
        );
      } catch (error) {
        if (!alive) return;
        setAvailability({ available: false, reason: "backend-load-failed", detail: String(error) });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return availability;
}
