import { renderAppAsync } from "@lib/renderApp";

renderAppAsync(async function () {
    const ProjectWizard = (await import("./ProjectWizardApp")).ProjectWizardApp;
    return <ProjectWizard />;
});