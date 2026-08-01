import { useState, useEffect, useCallback, useMemo } from "react";
import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { parseVcsRemoteUrl } from "@shared/types/vcs";
import { WindowAppType } from "@shared/types/window";
import { CloneFailure, CloneStatus, ProjectData, ProjectFlow, WizardStep, ValidationErrors, DirectoryValidationResult } from "../types";
import { defaultProjectData, projectTemplates, WIZARD_FLOW_STEPS } from "../constants";
import { ValidationService } from "../services/validationService";
import { DirectoryService } from "../services/directoryService";
import { ProjectService } from "../services/projectService";
import { CloneService } from "../services/cloneService";
import { join } from "@shared/utils/path";

/**
 * The page that owns the destination-folder field, in either flow.
 *
 * The location checks - required, exists, is a directory, is empty - are the same checks for a
 * project about to be written and a project about to be copied in, so they are shared. What is
 * not shared is which page they belong to, and that has to be asked rather than hard-coded, or
 * the clone flow gets a Next button gated on errors from a page it never visits.
 */
function ownsLocation(step: WizardStep): boolean {
    return step === "settings" || step === "source";
}

/**
 * Custom hook for managing project wizard state and logic
 */
export function useProjectWizard() {
    const [currentStep, setCurrentStep] = useState<WizardStep>("template");
    const [appIdManuallyEdited, setAppIdManuallyEdited] = useState(false);
    const [platformInfo, setPlatformInfo] = useState<any>(null);
    const [defaultLocation, setDefaultLocation] = useState<string>("");
    const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
    const [directoryValidation, setDirectoryValidation] = useState<DirectoryValidationResult | null>(null);
    const [isValidatingDirectory, setIsValidatingDirectory] = useState(false);
    const [isSelectingDirectory, setIsSelectingDirectory] = useState(false);
    const [locationInputDirty, setLocationInputDirty] = useState(false);
    const [locationInputFocused, setLocationInputFocused] = useState(false);
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [creationError, setCreationError] = useState<string | null>(null);
    const [locationManuallyEdited, setLocationManuallyEdited] = useState(false);
    const [cloneStatus, setCloneStatus] = useState<CloneStatus>("idle");
    const [cloneFailure, setCloneFailure] = useState<CloneFailure | null>(null);

    const [projectData, setProjectData] = useState<ProjectData>(defaultProjectData);

    /** Which wizard the first-page card started. `create` until one is picked. */
    const flow: ProjectFlow = useMemo(
        () => projectTemplates.find(template => template.id === projectData.template)?.flow ?? "create",
        [projectData.template],
    );
    const steps = WIZARD_FLOW_STEPS[flow];

    /** The server and repository name the address names, or null while it is not an address yet. */
    const remote = useMemo(() => parseVcsRemoteUrl(projectData.remoteUrl), [projectData.remoteUrl]);

    // Fetch the appropriate default directory for the user's platform
    useEffect(() => {
        const fetchDefaultDirectory = async () => {
            const result = await DirectoryService.getDefaultProjectDirectory();
            if (result.success && result.data?.dir) {
                setDefaultLocation(result.data.dir);
            } else {
                console.warn("Failed to get platform-specific directory, using fallback");
                setDefaultLocation("~/Projects");
            }
        };

        fetchDefaultDirectory();
    }, []);

    /**
     * Keep the location field pointed somewhere sensible for the flow the author is in, and check
     * it without waiting for a blur that may never come.
     *
     * The two flows want different suggestions from the same default folder. A project being
     * created goes IN it. **A clone cannot**: the destination has to be empty, and on any machine
     * that has ever made a project the default folder is not - so the clone flow's suggestion is a
     * new subfolder named after the repository, which is both the only answer that works and the
     * one the author would have typed. Until an address parses there is nothing to name it after,
     * and the field stays empty rather than holding a path that would be refused.
     *
     * Both are validated here rather than on blur, because in the clone flow nobody necessarily
     * ever focuses this field - and an occupied folder has to be said on this page, not by the
     * backend after the button on the last page has started a transfer.
     *
     * **Everything stops the moment the author edits the field themselves.** Past that point the
     * path is theirs; moving one that somebody has edited is worse than leaving a stale
     * suggestion, and it is how switching flows would silently discard a chosen folder.
     */
    useEffect(() => {
        if (locationManuallyEdited || !defaultLocation) {
            return;
        }

        const suggested = flow === "clone"
            ? (remote ? join(defaultLocation, remote.name) : "")
            : defaultLocation;

        setProjectData(prev => (prev.location === suggested ? prev : { ...prev, location: suggested }));
        setValidationErrors(prev => ({ ...prev, location: undefined, directory: undefined }));
        setDirectoryValidation(null);
        setLocationInputDirty(false);

        if (!suggested) {
            return;
        }
        // Debounced: the clone flow's suggestion changes on every keystroke of the repository
        // name, and a mid-word path is not worth an IPC round trip.
        const timer = setTimeout(() => void validateProjectDirectory(suggested), 200);
        return () => clearTimeout(timer);
    }, [flow, remote, defaultLocation, locationManuallyEdited]);

    /**
     * Update project name and auto-generate app ID if not manually edited
     */
    const updateProjectName = useCallback((name: string) => {
        setProjectData(prevData => {
            const newData = { ...prevData, name };

            // Only auto-generate app ID if it wasn't manually edited
            if (!appIdManuallyEdited) {
                newData.appId = ValidationService.generateAppId(name);
            }

            return newData;
        });
    }, [appIdManuallyEdited]);

    /**
     * Update app ID and mark as manually edited
     */
    const updateAppId = useCallback((appId: string) => {
        setProjectData(prevData => ({ ...prevData, appId }));
        setAppIdManuallyEdited(true);
    }, []);

    /**
     * Update project data
     */
    const updateProjectData = useCallback((updates: Partial<ProjectData>) => {
        setProjectData(prevData => ({ ...prevData, ...updates }));

        // If location changed, mark input as dirty (will be validated on blur)
        if (updates.location) {
            setLocationInputDirty(true);
            // Clear any existing validation errors for location until blur validation
            setValidationErrors(prev => ({
                ...prev,
                location: undefined,
                directory: undefined
            }));
        }
    }, []);

    /**
     * Validate project directory
     */
    const validateProjectDirectory = useCallback(async (path: string) => {
        // Clear previous validation errors
        setValidationErrors(prev => ({
            ...prev,
            location: undefined,
            directory: undefined
        }));
        setDirectoryValidation(null);

        setIsValidatingDirectory(true);
        try {
            const result = await ValidationService.validateProjectDirectory(path, platformInfo);

            setValidationErrors(result.errors);
            if (result.data) {
                setDirectoryValidation(result.data);
            }
        } catch (error) {
            setValidationErrors(prev => ({
                ...prev,
                directory: translate("wizard.validation.failedToValidate")
            }));
        } finally {
            setIsValidatingDirectory(false);
        }
    }, [platformInfo]);

    /**
     * Handle location change
     */
    const handleLocationChange = useCallback((value: string) => {
        // Marks the field as the author's from here on, which is what stops the clone flow's
        // address-derived suggestion from moving it out from under them on the next keystroke.
        setLocationManuallyEdited(true);
        updateProjectData({ location: value });
    }, [updateProjectData]);

    /**
     * Handle the server address a clone comes from.
     *
     * Nothing is validated in here on purpose: an address is invalid for most of the time it is
     * being typed, and saying so at every keystroke is noise. The Source page shows what it parses
     * to once it parses, and the Next button is what refuses one that never does.
     */
    const updateRemoteUrl = useCallback((remoteUrl: string) => {
        setProjectData(prevData => ({ ...prevData, remoteUrl }));
        // A new address is a new attempt; the last one's verdict no longer describes anything.
        setCloneFailure(null);
    }, []);

    /**
     * Handle location blur
     */
    const handleLocationBlur = useCallback(async () => {
        setLocationInputFocused(false);
        const error = ValidationService.validateLocation(projectData.location || "");
        setValidationErrors(prev => ({
            ...prev,
            location: error
        }));
        if (!error && projectData.location) {
            await validateProjectDirectory(projectData.location);
        }
        setLocationInputDirty(false);
    }, [projectData.location, validateProjectDirectory]);

    /**
     * Handle location focus
     */
    const handleLocationFocus = useCallback(() => {
        setLocationInputFocused(true);
    }, []);

    /**
     * Handle directory selection
     */
    const handleSelectDirectory = useCallback(async () => {
        setIsSelectingDirectory(true);
        // Picking a folder is editing the field. Without this the clone flow's address-derived
        // suggestion would overwrite the folder the author just walked a dialog to choose.
        setLocationManuallyEdited(true);
        try {
            const result = await DirectoryService.selectProjectDirectory();
            if (result.success && result.data?.dest) {
                let selectedPath = result.data.dest;

                // Clear validation errors when a directory is selected
                setValidationErrors(prev => ({
                    ...prev,
                    location: undefined,
                    directory: undefined
                }));
                setDirectoryValidation(null);
                setLocationInputDirty(false);
                setLocationInputFocused(false);

                // Validate the selected directory first
                const validationResult = await ValidationService.validateProjectDirectory(selectedPath, platformInfo);

                // A folder that already holds something gets a subfolder rather than a refusal.
                // Named after the app for a project being created, and after the repository for
                // one being copied down - which is the only name a clone has at this point, and
                // the same one the server knows it by.
                const subfolder = flow === "clone" ? remote?.name : projectData.appId;

                // If directory is not empty and a subfolder name exists, append it to the path
                if (validationResult.data && !validationResult.data.isEmpty && subfolder) {
                    selectedPath = join(selectedPath, subfolder);
                    // Update location with the new path that includes the subfolder
                    updateProjectData({ location: selectedPath });
                    // Validate the new path
                    await validateProjectDirectory(selectedPath);
                    // Reset input state after validation completes
                    setLocationInputDirty(false);
                    setLocationInputFocused(false);
                } else {
                    // Directory is empty or there is no subfolder name, use original path
                    updateProjectData({ location: selectedPath });
                    // Set validation result
                    if (validationResult.data) {
                        setDirectoryValidation(validationResult.data);
                    }
                    setValidationErrors(validationResult.errors);
                    // Reset input state after validation completes
                    setLocationInputDirty(false);
                    setLocationInputFocused(false);
                }
            }
        } catch (error) {
            console.error("Failed to select directory:", error);
        } finally {
            setIsSelectingDirectory(false);
        }
    }, [updateProjectData, validateProjectDirectory, projectData.appId, platformInfo, flow, remote]);

    /**
     * Move to an adjacent page of whichever flow the author is in.
     *
     * The page list is the flow's, not a constant: the clone flow skips Details and Settings
     * entirely, so walking a fixed four-step array would step onto pages that ask a project on a
     * server questions it has already answered.
     */
    const goToAdjacentStep = useCallback((offset: -1 | 1) => {
        const currentIndex = steps.indexOf(currentStep);
        const target = steps[currentIndex + offset];
        if (currentIndex < 0 || !target) {
            return;
        }
        setCurrentStep(target);
        // Clear location validation errors when leaving the page that owns the location field
        if (ownsLocation(currentStep) && !ownsLocation(target)) {
            setValidationErrors(prev => ({
                ...prev,
                location: undefined,
                directory: undefined
            }));
            setLocationInputDirty(false);
            setLocationInputFocused(false);
        }
    }, [currentStep, steps]);

    /**
     * Navigate to next step
     */
    const nextStep = useCallback(() => goToAdjacentStep(1), [goToAdjacentStep]);

    /**
     * Navigate to previous step
     */
    const prevStep = useCallback(() => goToAdjacentStep(-1), [goToAdjacentStep]);

    /**
     * Check if current step is valid
     */
    const isStepValid = useCallback(() => {
        return ValidationService.isStepValid(currentStep, projectData);
    }, [currentStep, projectData]);

    /**
     * Check if can proceed to next step
     */
    const canProceed = useCallback(() => {
        // UX: Prevent proceeding if input is focused (user is typing) or dirty (modified but not validated)
        // Only check location validation errors on the page that owns the location field
        const locationValid = !ownsLocation(currentStep) ||
            (!validationErrors.location &&
             !validationErrors.directory &&
             !locationInputDirty &&
             !locationInputFocused);

        return isStepValid() && locationValid;
    }, [isStepValid, validationErrors, locationInputDirty, locationInputFocused, currentStep]);

    /**
     * Create project
     */
    const createProject = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
        const validation = ProjectService.validateProjectData(projectData);
        if (!validation.isValid) {
            const error = validation.errors.join(", ");
            setCreationError(error);
            return { success: false, error };
        }

        setIsCreatingProject(true);
        setCreationError(null);
        try {
            const result = await ProjectService.createProject(projectData);
            if (!result.success) {
                setCreationError(result.error || translate("wizard.validation.createFailed"));
            }
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setCreationError(errorMessage);
            return { success: false, error: errorMessage };
        } finally {
            setIsCreatingProject(false);
        }
    }, [projectData]);

    /**
     * Copy the project down from its server, and only then hand it on.
     *
     * **The window closes on a verified project and on nothing else.** `closeWith` is what tells
     * the launcher to open what is at that path, so reporting a clone that brought down something
     * Studio cannot read would move the failure to a window that has no idea where the folder came
     * from and no way back to the address that produced it. A bad verdict keeps the author here,
     * on the page that still holds both.
     *
     * Failures are held in state rather than thrown: this is the last page, and there is nowhere
     * for the author to go except to correct the address or the folder and press it again.
     */
    const cloneProject = useCallback(async (): Promise<void> => {
        setCloneFailure(null);
        setCloneStatus("cloning");
        try {
            const outcome = await CloneService.cloneProject(projectData.remoteUrl, projectData.location);
            if (outcome.status === "failed") {
                setCloneFailure({ kind: "failed", message: outcome.error });
                return;
            }
            if (outcome.status === "notAProject") {
                setCloneFailure({ kind: "notAProject", destination: outcome.root });
                return;
            }
            getInterface().window.closeWith<WindowAppType.ProjectWizard>({
                created: true,
                projectPath: outcome.root,
            });
        } finally {
            setCloneStatus("idle");
        }
    }, [projectData.remoteUrl, projectData.location]);

    return {
        // State
        currentStep,
        steps,
        flow,
        remote,
        projectData,
        validationErrors,
        directoryValidation,
        isValidatingDirectory,
        isSelectingDirectory,
        isCreatingProject,
        creationError,
        cloneStatus,
        cloneFailure,
        locationInputDirty,
        locationInputFocused,
        appIdManuallyEdited,

        // Actions
        updateProjectName,
        updateAppId,
        updateProjectData,
        updateRemoteUrl,
        handleLocationChange,
        handleLocationBlur,
        handleLocationFocus,
        handleSelectDirectory,
        cloneProject,
        nextStep,
        prevStep,
        createProject,
        validateProjectDirectory,
        clearCreationError: () => setCreationError(null),

        // Computed
        canProceed,
        isStepValid,
    };
}
