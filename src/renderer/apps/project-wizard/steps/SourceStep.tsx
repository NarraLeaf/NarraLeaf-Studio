import { FolderOpen } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Input, InputGroup } from "@/lib/components/elements";
import { DirectoryValidationResult, ProjectData, ValidationErrors } from "../types";

interface SourceStepProps {
  projectData: ProjectData;
  /** What the address parses to, or null while it is not an address yet. */
  remote: { origin: string; name: string } | null;
  updateRemoteUrl: (url: string) => void;
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
 * Everything a project that already exists on a server needs to be asked.
 *
 * **Two fields, and that is the whole of it.** Name, app id, stage size and author are all already
 * recorded in the project on the server; asking for them here would let the author give answers
 * that the clone then silently overwrites, which is worse than not asking. What is genuinely
 * unknown is where the project is and where it should land.
 *
 * The address is echoed back split into the server and the name it carries, once it parses. That
 * readback is the only feedback available before the transfer starts - the backend has nothing to
 * say about an address until it is asked to use it - and it catches the mistake that actually
 * happens: a colleague's address pasted with the project name of a different project on the end.
 */
export function SourceStep({
  projectData,
  remote,
  updateRemoteUrl,
  validationErrors,
  directoryValidation,
  isValidatingDirectory,
  onLocationChange,
  onLocationBlur,
  onLocationFocus,
  onSelectDirectory,
  isSelectingDirectory
}: SourceStepProps) {
  const { t } = useTranslation();
  // Only once they have typed something: an empty field is not a mistake, it is a field they
  // have not reached yet.
  const addressInvalid = projectData.remoteUrl.trim() !== "" && !remote;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-xl space-y-4">
        <InputGroup
          label={t("wizard.source.addressLabel")}
          required
          error={addressInvalid ? t("wizard.source.addressInvalid") : undefined}
          helper={remote ? undefined : t("wizard.source.addressHint")}
        >
          <Input
            autoFocus
            placeholder="lore://studio.example.lan:41337/my-game"
            value={projectData.remoteUrl}
            onChange={(event) => updateRemoteUrl(event.target.value)}
          />
        </InputGroup>

        {remote && (
          <div className="overflow-hidden rounded-md border border-edge">
            <ReadbackRow label={t("wizard.source.parsedServer")} value={remote.origin} />
            <ReadbackRow label={t("wizard.source.parsedName")} value={remote.name} first={false} />
          </div>
        )}

        <InputGroup
          label={t("wizard.fields.location")}
          required
          error={validationErrors.location || validationErrors.directory}
          helper={
            isValidatingDirectory
              ? t("wizard.project.validatingDirectory")
              : directoryValidation && !directoryValidation.exists
                ? t("wizard.project.directoryWillBeCreated")
                : t("wizard.source.destinationHint")
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
      </div>
    </div>
  );
}

function ReadbackRow({
  label,
  value,
  first = true
}: {
  label: string;
  value: string;
  first?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 px-3 py-2 text-sm ${
        first ? "" : "border-t border-edge"
      }`}
    >
      <span className="shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 break-all text-right text-fg">{value}</span>
    </div>
  );
}
