import { AppLayout } from "@/lib/components/layout";
import { DevModeContent } from "./components/DevModeContent";
import { useDevModePayload } from "./hooks/useDevModePayload";

export function DevModeApp() {
    const { bundle, surface, surfaceId, rendererRegistry, scale, handleAspectUpdate } = useDevModePayload();

    return (
        <AppLayout title="Dev Mode" iconSrc="/favicon.ico">
            <div className="h-full w-full min-h-0 bg-[#0f1115] overflow-hidden">
                <DevModeContent
                    bundle={bundle}
                    surface={surface}
                    surfaceId={surfaceId}
                    rendererRegistry={rendererRegistry}
                    scale={scale}
                    handleAspectUpdate={handleAspectUpdate}
                />
            </div>
        </AppLayout>
    );
}

export default DevModeApp;
