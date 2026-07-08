import React from "react";
import { Loader2 } from "lucide-react";

interface LoadingScreenProps {
    message?: string;
}

/**
 * Loading screen component
 * Displayed while workspace is initializing
 */
export function LoadingScreen({ message = "Initializing workspace..." }: LoadingScreenProps) {
    return (
        <div className="h-screen w-screen flex items-center justify-center bg-surface">
            <div className="text-center">
                <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
                <p className="text-lg text-fg-muted">{message}</p>
            </div>
        </div>
    );
}

