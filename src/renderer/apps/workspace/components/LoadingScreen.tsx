import React from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface LoadingScreenProps {
    message?: string;
}

/**
 * Loading screen component
 * Displayed while workspace is initializing
 */
export function LoadingScreen({ message }: LoadingScreenProps) {
    const { t } = useTranslation();
    return (
        <div className="h-screen w-screen flex items-center justify-center bg-surface">
            <div className="text-center">
                <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
                <p className="text-lg text-fg-muted">{message ?? t("workspace.shell.initializing")}</p>
            </div>
        </div>
    );
}

