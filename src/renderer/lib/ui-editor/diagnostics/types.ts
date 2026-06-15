export type UISurfaceDiagnosticSeverity = "info" | "warning" | "error";

export type UISurfaceDiagnosticSource =
    | "resource"
    | "link"
    | "stage"
    | "layout"
    | "interaction"
    | "blueprint";

export type UISurfaceDiagnostic = {
    id: string;
    severity: UISurfaceDiagnosticSeverity;
    source: UISurfaceDiagnosticSource;
    message: string;
    hint?: string;
    /** Optional element id for canvas / inspector hints */
    elementId?: string;
};

export const SURFACE_DIAGNOSTIC_SEVERITY_ORDER: Record<UISurfaceDiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
};

export function sortSurfaceDiagnostics(items: UISurfaceDiagnostic[]): UISurfaceDiagnostic[] {
    return [...items].sort(
        (a, b) =>
            SURFACE_DIAGNOSTIC_SEVERITY_ORDER[a.severity] - SURFACE_DIAGNOSTIC_SEVERITY_ORDER[b.severity],
    );
}

export function summarizeDiagnostics(items: UISurfaceDiagnostic[]): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const d of items) {
        if (d.severity === "error") {
            errors += 1;
        } else if (d.severity === "warning") {
            warnings += 1;
        }
    }
    return { errors, warnings };
}
