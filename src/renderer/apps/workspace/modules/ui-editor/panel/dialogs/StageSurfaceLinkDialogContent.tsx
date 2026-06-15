import { useEffect, useState } from "react";
import { Select, SelectOption } from "@/lib/components/elements/Select";

export type StageSurfaceLinkDialogValue = {
    stageSurfaceId: string;
    appSurfaceId: string | null;
};

type StageSurfaceLinkDialogContentProps = {
    stageSurfaceOptions: SelectOption[];
    appSurfaceOptions: SelectOption[];
    initialStageSurfaceId: string;
    initialAppSurfaceId: string | null;
    onChange: (value: StageSurfaceLinkDialogValue) => void;
};

export function StageSurfaceLinkDialogContent({
    stageSurfaceOptions,
    appSurfaceOptions,
    initialStageSurfaceId,
    initialAppSurfaceId,
    onChange,
}: StageSurfaceLinkDialogContentProps) {
    const [stageSurfaceId, setStageSurfaceId] = useState(initialStageSurfaceId);
    const [appSurfaceId, setAppSurfaceId] = useState(initialAppSurfaceId ?? "");

    useEffect(() => {
        onChange({
            stageSurfaceId,
            appSurfaceId: appSurfaceId === "" ? null : appSurfaceId,
        });
    }, [appSurfaceId, onChange, stageSurfaceId]);

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-200">Stage surface</div>
                <Select
                    options={stageSurfaceOptions}
                    value={stageSurfaceId}
                    onChange={value => setStageSurfaceId(String(value))}
                    fullWidth
                />
            </div>

            <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-200">App surface</div>
                <Select
                    options={appSurfaceOptions}
                    value={appSurfaceId}
                    onChange={value => setAppSurfaceId(String(value))}
                    fullWidth
                />
            </div>
        </div>
    );
}
