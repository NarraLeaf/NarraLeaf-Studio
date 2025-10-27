import { getInterface } from "@/lib/app/bridge";
import { ProjectData } from "../types";

/**
 * Service for handling project creation logic
 */
export class ProjectService {
    /**
     * Create a new project with the provided data
     * TODO: Implement actual project creation logic
     */
    static async createProject(projectData: ProjectData): Promise<{ success: boolean; error?: string }> {
        try {
            // TODO: Implement project creation logic
            console.log("Creating project:", projectData);

            // For now, just simulate project creation
            await new Promise(resolve => setTimeout(resolve, 1000));

            return { success: true };
        } catch (error) {
            console.error("Failed to create project:", error);
            return { success: false, error: "Failed to create project" };
        }
    }

    /**
     * Validate project data before creation
     */
    static validateProjectData(projectData: ProjectData): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!projectData.name.trim()) {
            errors.push("Project name is required");
        }

        if (!projectData.appId.trim()) {
            errors.push("App ID is required");
        }

        if (!projectData.location.trim()) {
            errors.push("Project location is required");
        }

        if (!projectData.template) {
            errors.push("Project template is required");
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
