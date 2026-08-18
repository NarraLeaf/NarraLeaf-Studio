import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Button, Input, InputGroup } from "@/lib/components/elements";
import {
  DirectoryValidationResult,
  ImportFailure,
  ImportStatus,
  ProjectData,
  ValidationErrors
} from "../types";

interface ImportStepProps {
  projectData: ProjectData;
  importStatus: ImportStatus;
  importFailure: ImportFailure | null;
  validationErrors: ValidationErrors;
  directoryValidation: DirectoryValidationResult | null;
  isValidatingDirectory: boolean;
  onSelectPackage: () => Promise<void>;
  isSelectingPackage: boolean;
  onSelectDirectory: () => Promise<void>;
  isSelectingDirectory: boolean;
}

/**
 * The two answers an import needs, each behind its own button.
 *
 * **This page used to have no fields.** Both choices were made in native dialogs that opened
 * back-to-back after the footer button, so the page could only describe what was about to happen -
 * and once it had happened there was nothing on screen saying which file had been read or where it
 * had gone. Choosing one of the two again meant starting the whole thing over.
 *
 * Neither field is typable, and that is not a shortcut. A path this window was not handed by a
 * native dialog is a path it has no permission to read (see the storage manager), so a typed one
 * could only ever fail - and it would fail as "access denied" rather than as "that is not where
 * the file is". The picker is the only way in, so it is the only way offered.
 */
export function ImportStep({
  projectData,
  importStatus,
  importFailure,
  validationErrors,
  directoryValidation,
  isValidatingDirectory,
  onSelectPackage,
  isSelectingPackage,
  onSelectDirectory,
  isSelectingDirectory
}: ImportStepProps) {
  const { t } = useTranslation();
  const busy = importStatus === "unpacking";

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-xl space-y-4">
        <InputGroup label={t("wizard.import.packageLabel")} required>
          <div className="flex items-center gap-2">
            <PathField
              value={projectData.packagePath}
              placeholder={t("wizard.import.packagePlaceholder")}
            />
            <Button
              variant="secondary"
              onClick={() => void onSelectPackage()}
              disabled={isSelectingPackage || busy}
            >
              {t("wizard.import.choosePackage")}
            </Button>
          </div>
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
          <div className="flex items-center gap-2">
            <PathField
              value={projectData.location}
              placeholder={t("wizard.import.locationPlaceholder")}
            />
            <Button
              variant="secondary"
              onClick={() => void onSelectDirectory()}
              disabled={isSelectingDirectory || isValidatingDirectory || busy}
            >
              {t("wizard.import.chooseFolder")}
            </Button>
          </div>
        </InputGroup>

        {busy && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            {t("wizard.import.working")}
          </div>
        )}

        {!busy && importFailure && (
          <div className="rounded-md border border-danger/20 bg-danger/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-danger">
                  {importFailure.kind === "notAProject"
                    ? t("wizard.import.error.notAProjectTitle")
                    : t("wizard.import.error.failedTitle")}
                </p>
                <p className="break-words text-xs text-danger">
                  {importFailure.kind === "notAProject"
                    ? t("wizard.import.error.notAProject", { path: importFailure.destination })
                    : importFailure.message}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A chosen path, shown from its end.
 *
 * A field this narrow truncates on the right, which for a path means showing `C:\Users\hello\App…`
 * and hiding the one part that identifies what was picked. Scrolling it to the end puts the file
 * or folder name in view and leaves the rest reachable by dragging - the same thing an address bar
 * does, and better than a `title` tooltip, which covers the field it describes.
 */
function PathField({ value, placeholder }: { value: string; placeholder: string }) {
  // Reached through the wrapper rather than a ref on the control: `Input` renders its own
  // relative-positioned box around the element and does not forward one.
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const input = wrapper.current?.querySelector("input");
    if (input) {
      input.scrollLeft = input.scrollWidth;
    }
  }, [value]);

  return (
    <div ref={wrapper} className="min-w-0 flex-1">
      <Input readOnly fullWidth value={value} placeholder={placeholder} />
    </div>
  );
}
