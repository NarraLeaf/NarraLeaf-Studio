import { FolderX, LogOut } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, TitleBar } from "@/lib/components";

interface MissingProjectConfigScreenProps {
    projectPath?: string;
}

export function MissingProjectConfigScreen({ projectPath }: MissingProjectConfigScreenProps) {
    const handleOpenLauncher = () => {
        void getInterface().workspace.close();
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-surface text-fg">
            <TitleBar title="NarraLeaf Studio" iconSrc="/favicon.ico" />
            <main className="min-h-0 flex-1 flex items-center justify-center px-8">
                <section className="w-full max-w-sm text-center">
                    <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted">
                        <FolderX className="h-5 w-5" />
                    </div>
                    <h1 className="text-base font-semibold text-white">This folder is not a NarraLeaf project</h1>
                    <p className="mt-2 text-sm leading-6 text-fg-muted">
                        No .nlproj file was found.
                    </p>
                    {projectPath && (
                        <p className="mt-3 truncate text-xs text-fg-subtle" title={projectPath}>
                            {projectPath}
                        </p>
                    )}
                    <Button
                        variant="secondary"
                        size="md"
                        onClick={handleOpenLauncher}
                        className="mt-6 h-9"
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Open Launcher</span>
                    </Button>
                </section>
            </main>
        </div>
    );
}
