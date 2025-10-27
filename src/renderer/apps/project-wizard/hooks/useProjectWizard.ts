import { useState, useEffect, useCallback } from "react";
import { ProjectData, WizardStep, ValidationErrors, DirectoryValidationResult } from "../types";
import { defaultProjectData } from "../constants";
import { ValidationService } from "../services/validationService";
import { DirectoryService } from "../services/directoryService";
import { ProjectService } from "../services/projectService";

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

    const [projectData, setProjectData] = useState<ProjectData>(defaultProjectData);

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

    // Update location with default value once available
    useEffect(() => {
        if (defaultLocation && !projectData.location) {
            setProjectData(prev => ({ ...prev, location: defaultLocation }));
            // Validate the default location immediately since it's from a trusted source
            setTimeout(async () => {
                if (defaultLocation) {
                    await validateProjectDirectory(defaultLocation);
                }
            }, 100);
        }
    }, [defaultLocation]);

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
                directory: "Failed to validate directory"
            }));
        } finally {
            setIsValidatingDirectory(false);
        }
    }, [platformInfo]);

    /**
     * Handle location change
     */
    const handleLocationChange = useCallback((value: string) => {
        updateProjectData({ location: value });
    }, [updateProjectData]);

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
        try {
            const result = await DirectoryService.selectProjectDirectory();
            if (result.success && result.data?.dest) {
                updateProjectData({ location: result.data.dest });
                // Clear validation errors when a directory is selected
                setValidationErrors(prev => ({
                    ...prev,
                    location: undefined,
                    directory: undefined
                }));
                setDirectoryValidation(null);
                setLocationInputDirty(false);
                setLocationInputFocused(false);

                // Validate the selected directory
                await validateProjectDirectory(result.data.dest);
            }
        } catch (error) {
            console.error("Failed to select directory:", error);
        } finally {
            setIsSelectingDirectory(false);
        }
    }, [updateProjectData, validateProjectDirectory]);

    /**
     * Navigate to next step
     */
    const nextStep = useCallback(() => {
        const stepKeys: WizardStep[] = ["template", "details", "settings", "review"];
        const currentIndex = stepKeys.indexOf(currentStep);
        if (currentIndex < stepKeys.length - 1) {
            setCurrentStep(stepKeys[currentIndex + 1]);
        }
    }, [currentStep]);

    /**
     * Navigate to previous step
     */
    const prevStep = useCallback(() => {
        const stepKeys: WizardStep[] = ["template", "details", "settings", "review"];
        const currentIndex = stepKeys.indexOf(currentStep);
        if (currentIndex > 0) {
            setCurrentStep(stepKeys[currentIndex - 1]);
        }
    }, [currentStep]);

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
        return isStepValid() &&
               !validationErrors.location &&
               !validationErrors.directory &&
               !locationInputDirty &&
               !locationInputFocused;
    }, [isStepValid, validationErrors, locationInputDirty, locationInputFocused]);

    /**
     * Create project
     */
    const createProject = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
        const validation = ProjectService.validateProjectData(projectData);
        if (!validation.isValid) {
            return { success: false, error: validation.errors.join(", ") };
        }

        setIsCreatingProject(true);
        try {
            const result = await ProjectService.createProject(projectData);
            return result;
        } finally {
            setIsCreatingProject(false);
        }
    }, [projectData]);

    return {
        // State
        currentStep,
        projectData,
        validationErrors,
        directoryValidation,
        isValidatingDirectory,
        isSelectingDirectory,
        isCreatingProject,
        locationInputDirty,
        locationInputFocused,
        appIdManuallyEdited,

        // Actions
        updateProjectName,
        updateAppId,
        updateProjectData,
        handleLocationChange,
        handleLocationBlur,
        handleLocationFocus,
        handleSelectDirectory,
        nextStep,
        prevStep,
        createProject,
        validateProjectDirectory,

        // Computed
        canProceed,
        isStepValid,
    };
}
