import { transliterate } from "transliteration";
import { getInterface } from "@/lib/app/bridge";
import { PlatformSystem } from "@shared/types/os";
import { ProjectData, DirectoryValidationResult, ValidationErrors } from "../types";

/**
 * Service for handling all validation logic in the project wizard
 */
export class ValidationService {
    /**
     * Generate a valid app ID from project name with transliteration
     */
    static generateAppId(name: string): string {
        // Use transliteration library to convert non-English characters
        const transliterated = transliterate(name);

        return transliterated
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
            .substring(0, 50); // Limit length
    }

    /**
     * Validate if app ID contains only allowed characters
     */
    static validateAppId(appId: string): boolean {
        return /^[a-z0-9-]+$/.test(appId);
    }

    /**
     * Validate location path
     */
    static validateLocation(location: string): string | undefined {
        if (!location || location.trim() === "") {
            return "Project location is required";
        }
        return undefined;
    }

    /**
     * Validate if path points to a valid drive/directory that exists
     * This checks basic path validity without requiring the directory to exist
     */
    static async validatePathDrive(path: string, platformInfo?: any): Promise<{ success: boolean; error?: string }> {
        try {
            const interface_ = getInterface();

            // For Windows, check if the drive exists
            if (platformInfo?.system === PlatformSystem.win32) {
                // Extract drive letter (e.g., "C:" from "C:\Projects")
                const driveMatch = path.match(/^([A-Za-z]):/);
                if (driveMatch) {
                    const drive = driveMatch[1];
                    const drivePath = `${drive}:\\`;

                    // Check if drive exists and is accessible
                    const driveExistsResult = await interface_.fs.isDirExists(drivePath);
                    if (!driveExistsResult.success) {
                        return { success: false, error: `Drive ${drive}: is not accessible` };
                    }
                }
            }

            // For Unix-like systems, check if we can access basic directories
            else {
                // Check if we can access the root directory (basic system validation)
                const rootResult = await interface_.fs.isDirExists("/");
                if (!rootResult.success) {
                    return { success: false, error: "Root directory is not accessible" };
                }
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: "Path validation failed" };
        }
    }

    /**
     * Validate directory and return detailed information
     */
    static async validateDirectory(path: string): Promise<{ success: boolean; error?: string; data?: DirectoryValidationResult }> {
        try {
            const interface_ = getInterface();

            // Check if directory exists
            const dirExistsResult = await interface_.fs.isDirExists(path);
            if (!dirExistsResult.success) {
                return { success: false, error: "Failed to check directory existence" };
            }

            // Check if it's actually a directory
            const isDirResult = await interface_.fs.isDir(path);
            if (!isDirResult.success) {
                return { success: false, error: "Failed to check if path is directory" };
            }

            const exists = dirExistsResult.success ? (dirExistsResult.data?.ok ? dirExistsResult.data.data : false) : false;
            const isDirectory = isDirResult.success ? (isDirResult.data?.ok ? isDirResult.data.data : false) : false;

            if (!exists) {
                return {
                    success: true,
                    data: {
                        exists: false,
                        isDirectory: false,
                        isEmpty: true,
                        canWrite: true
                    }
                };
            }

            if (!isDirectory) {
                return {
                    success: true,
                    data: {
                        exists: true,
                        isDirectory: false,
                        isEmpty: true,
                        canWrite: false
                    }
                };
            }

            // Check if directory is empty (check both files and subdirectories)
            // Use fs.list which now returns all entries (files and directories) via Fs.dirEntries
            const listResult = await interface_.fs.list(path);
            if (!listResult.success) {
                return { success: false, error: "Failed to list directory contents" };
            }

            // Directory is empty if the list has no entries
            const isEmpty = listResult.data?.ok ? (listResult.data.data?.length ?? 0) === 0 : false;

            // For now, assume we can write if it exists and is a directory
            // In a real implementation, you might want to check write permissions
            const canWrite = exists && isDirectory;

            return {
                success: true,
                data: {
                    exists,
                    isDirectory,
                    isEmpty,
                    canWrite
                }
            };
        } catch (error) {
            return { success: false, error: "Failed to validate directory" };
        }
    }

    /**
     * Comprehensive project directory validation
     */
    static async validateProjectDirectory(path: string, platformInfo?: any): Promise<{
        success: boolean;
        errors: ValidationErrors;
        data?: DirectoryValidationResult;
    }> {
        const errors: ValidationErrors = {};

        const locationError = this.validateLocation(path);
        if (locationError) {
            errors.location = locationError;
            return { success: false, errors };
        }

        try {
            // First validate that the path points to a valid drive/location
            const driveValidation = await this.validatePathDrive(path, platformInfo);
            if (!driveValidation.success) {
                errors.directory = driveValidation.error || "Invalid path";
                return { success: false, errors };
            }

            const validationResult = await this.validateDirectory(path);

            if (validationResult.success && validationResult.data) {
                // Check if directory is valid for project creation
                // Note: Directory not existing is OK since we will create it
                // Only show errors for actual problems (file exists, no write permission, not empty)
                if (validationResult.data.exists && !validationResult.data.isDirectory) {
                    errors.directory = "Selected path exists but is not a directory. Please choose a directory or create a new one.";
                } else if (validationResult.data.exists && !validationResult.data.canWrite) {
                    errors.directory = "Cannot write to the selected directory. Please check permissions or choose a different location.";
                } else if (validationResult.data.exists && !validationResult.data.isEmpty) {
                    errors.directory = "Directory is not empty. Please choose an empty directory or create a new one.";
                }
                // If all checks pass or directory doesn't exist (which is OK), clear directory error
                else {
                    errors.directory = undefined;
                }

                return {
                    success: !errors.location && !errors.directory,
                    errors,
                    data: validationResult.data
                };
            } else {
                errors.directory = validationResult.error || "Directory validation failed";
                return { success: false, errors };
            }
        } catch (error) {
            errors.directory = "Failed to validate directory";
            return { success: false, errors };
        }
    }

    /**
     * Check if all validation passes for current step
     */
    static isStepValid(step: string, projectData: ProjectData): boolean {
        switch (step) {
            case "template":
                return projectData.template !== "";
            case "details":
                return projectData.name.trim() !== "" &&
                       projectData.resolution !== "" &&
                       projectData.appId.trim() !== "" &&
                       this.validateAppId(projectData.appId);
            case "settings":
                return projectData.location !== undefined &&
                       projectData.location.trim() !== "" &&
                       projectData.versionControl !== "";
            case "review":
                return projectData.name.trim() !== "" &&
                       projectData.resolution !== "" &&
                       projectData.appId.trim() !== "" &&
                       this.validateAppId(projectData.appId) &&
                       projectData.location !== undefined &&
                       projectData.location.trim() !== "";
            default:
                return false;
        }
    }
}
