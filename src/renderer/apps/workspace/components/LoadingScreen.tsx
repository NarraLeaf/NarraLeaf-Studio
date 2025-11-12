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
        <div className="h-screen w-screen flex items-center justify-center bg-[#0f1115]">
            <div className="text-center">
                <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
                <p className="text-lg text-gray-300">{message}</p>
            </div>
        </div>
    );
}

