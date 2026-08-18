import { HELP_RESOURCES, HelpBrowser, type HelpTopicId } from "@/lib/help";

export interface LearningTabProps {
  /**
   * Topic to land on; the list's first otherwise. Set when the tab was opened on the author's
   * behalf - first-run setup ends on three links into it - and left unset when they picked the
   * tab themselves, because then they have not asked for a particular topic.
   */
  initialTopic?: HelpTopicId;
}

/**
 * The Learning tab: Studio's help topics, read here.
 *
 * It was a wall of cards linking to a website, which meant nothing about Studio could be read inside
 * Studio. It now renders the same topic registry the workspace's `F1` popover does, so the launcher
 * and the editor cannot document Studio differently; the links it used to be are the last section of
 * the list.
 *
 * No title row: the sidebar entry already names this page, and the plugins tab sets the precedent
 * for a launcher page that starts with its content.
 */
export function LearningTab({ initialTopic }: LearningTabProps) {
  return (
    <div className="h-full w-full text-fg">
      <HelpBrowser resources={HELP_RESOURCES} initialTopic={initialTopic} />
    </div>
  );
}
