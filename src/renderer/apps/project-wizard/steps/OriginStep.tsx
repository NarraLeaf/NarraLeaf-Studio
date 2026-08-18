import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatStageSize } from "@shared/types/stageSize";
import { projectOrigins } from "../constants";
import { stageSizeForTemplate } from "../stageSizeChoice";
import { ProjectData, ProjectFlow, ProjectTemplate } from "../types";

interface OriginStepProps {
  projectData: ProjectData;
  updateProjectData: (updates: Partial<ProjectData>) => void;
  flow: ProjectFlow;
  onFlowChange: (flow: ProjectFlow) => void;
  templates: ProjectTemplate[];
}

/**
 * Where the project is coming from, and - when it is being made here - what it is made from.
 *
 * **Two columns rather than one list of cards.** The question is really two questions, and they do
 * not grow at the same rate: there are three origins and there always will be, while templates are
 * content this build happens to ship and the store adds more. Mixed into one grid, every template
 * shipped pushed "from a server" further from the eye of somebody who came here to join a
 * colleague's project.
 *
 * Only `create` has a second column. The other two show what is about to happen instead, because
 * for them this page collects nothing at all - the next one does the whole of the work.
 */
export function OriginStep({
  projectData,
  updateProjectData,
  flow,
  onFlowChange,
  templates
}: OriginStepProps) {
  const { t } = useTranslation();

  const handleTemplateSelect = (template: ProjectTemplate) => {
    updateProjectData({
      template: template.id,
      // Cleared, not left behind: picking the blank entry after a template must not still
      // scaffold that template's content.
      contentTemplateId: template.contentTemplateId,
      // A template's content is laid out in absolute coordinates, so its declared size wins
      // over whatever was chosen for a different one. Kept when this template allows it.
      resolution: stageSizeForTemplate(projectData.resolution, template.stageSizes)
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="w-56 shrink-0 space-y-1 overflow-y-auto border-r border-edge p-3">
        {projectOrigins.map((origin) => {
          const OriginIcon = origin.icon;
          const selected = origin.flow === flow;
          return (
            <button
              key={origin.flow}
              type="button"
              onClick={() => onFlowChange(origin.flow)}
              aria-pressed={selected}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                selected ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"
              )}
            >
              <OriginIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm">{t(origin.labelKey)}</span>
                <span className="mt-0.5 block text-2xs text-fg-subtle">
                  {t(origin.descriptionKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {flow === "create" ? (
          <TemplateList
            templates={templates}
            selectedId={projectData.template}
            onSelect={handleTemplateSelect}
          />
        ) : (
          <p className="text-sm text-fg-muted">
            {t(flow === "import" ? "wizard.origin.import.next" : "wizard.origin.clone.next")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The templates, as bordered rows.
 *
 * Rows and not cards because the list is open-ended: a grid of cards is a fixed shape that has to
 * be redesigned every time it gains a member, and the thing a reader compares between two
 * templates - what is inside, and what stage it is drawn for - is a line of text either way.
 */
function TemplateList({
  templates,
  selectedId,
  onSelect
}: {
  templates: ProjectTemplate[];
  selectedId: string;
  onSelect: (template: ProjectTemplate) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-md border border-edge">
      {templates.map((template, index) => {
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            aria-pressed={selected}
            className={cn(
              "flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left transition-colors duration-150",
              index > 0 && "border-t border-edge",
              selected ? "bg-primary/10" : "hover:bg-fill"
            )}
          >
            <span className="min-w-0">
              <span className={cn("block text-sm", selected ? "text-fg" : "text-fg")}>
                {template.nameKey ? t(template.nameKey) : template.name}
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                {template.descriptionKey ? t(template.descriptionKey) : template.description}
              </span>
            </span>
            {/*
             * The stage a template was drawn for is the one thing about it the author
             * cannot change afterwards, so it is on the row rather than waiting on the
             * stage page. A template that declares none constrains nothing, and says
             * nothing here.
             */}
            {template.stageSizes.length > 0 && (
              <span className="shrink-0 whitespace-nowrap text-2xs text-fg-subtle">
                {template.stageSizes.map(formatStageSize).join(" · ")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
