import { getInterface } from "@/lib/app/bridge";

/**
 * Service for handling directory operations in the project wizard
 */
export class DirectoryService {
    /**
     * Get default project directory for the user's platform
     */
    static async getDefaultProjectDirectory(): Promise<{ success: boolean; data?: { dir: string }; error?: string }> {
        try {
            const interface_ = getInterface();
            const result = await interface_.getDefaultProjectDirectory();

            if (result && result.success && result.data.dir) {
                return { success: true, data: { dir: result.data.dir } };
            } else {
                // Fallback to ~/Projects if API fails
                console.warn("Failed to get platform-specific directory, using fallback");
                return { success: true, data: { dir: "~/Projects" } };
            }
        } catch (error) {
            console.error("Failed to get default project directory:", error);
            return { success: true, data: { dir: "~/Projects" } };
        }
    }

    /**
     * Select project directory using system dialog
     */
    static async selectProjectDirectory(): Promise<{ success: boolean; data?: { dest: string | null }; error?: string }> {
        try {
            const interface_ = getInterface();
            const result = await interface_.selectProjectDirectory();
            return result;
        } catch (error) {
            console.error("Failed to select directory:", error);
            return { success: false, error: "Failed to select directory" };
        }
    }
}
