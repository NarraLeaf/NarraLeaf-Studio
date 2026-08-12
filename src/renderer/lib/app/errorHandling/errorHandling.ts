
export type ErrorFallbackProps = Readonly<{
    /**
     * The source path of the page file that caused the error.
     *
     * Example: ".../pages/settings.tsx"
     */
    path?: string;
    /** The failure the boundary caught, where one was captured. */
    error?: Error;
}>;
