import { ChevronRight } from "lucide-react";
import { Button, FieldLabel } from "@/lib/components/elements";
import { helpTitleKey, type HelpTopicId } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";

/**
 * The three reads a first project needs, in the order it needs them: make one, write in it, run it.
 *
 * Titles come from the help catalog rather than from this flow's own namespace. A row here spelling
 * a topic differently from the list it opens is the drift the whole arrangement exists to avoid, and
 * setup would be the surface that starts it.
 */
const START_TOPICS: readonly HelpTopicId[] = ["newProject", "storyScene", "runModes"];

export interface DoneStepProps {
    /** Leave setup and land on this topic in the Learning tab. */
    onOpenTopic: (topic: HelpTopicId) => void;
}

/**
 * The closing screen's only content: three ways into the help that already exists.
 *
 * Not a tutorial. Setup owns two preferences and nothing else it could teach, so the last screen
 * points rather than explains - the same reason there is no tips dialog anywhere in Studio
 * (docs/help-system.md §5).
 */
export function DoneStep({ onOpenTopic }: DoneStepProps) {
    const { t } = useTranslation();

    return (
        <div>
            <FieldLabel as="div">{t("onboarding.done.topics")}</FieldLabel>
            {/* Pulled out by the button's own padding so the labels sit on the same left edge as
                the title and the line above them, and the rows read as a list rather than as a
                row of controls indented under one. */}
            <div className="-mx-2">
                {START_TOPICS.map(topic => (
                    <Button
                        key={topic}
                        variant="ghost"
                        size="sm"
                        fullWidth
                        className="group justify-between"
                        onClick={() => onOpenTopic(topic)}
                    >
                        <span className="min-w-0 truncate">{t(helpTitleKey(topic))}</span>
                        {/* Revealed on hover, like the help browser's own rows: the arrow says the
                            row goes somewhere, and three permanent chevrons say it three times. */}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </Button>
                ))}
            </div>
        </div>
    );
}
