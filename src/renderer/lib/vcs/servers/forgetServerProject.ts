import { forgetProject } from "@/lib/team";
import type { VcsServerProject } from "@shared/types/vcs";

/**
 * Taking one project off a server's list.
 *
 * **It removes the listing and nothing else.** The repository, its branches and every
 * revision in it stay exactly where they are on the server - measured, not assumed - so
 * a project removed here can be registered again under the same repository and come back
 * whole. The dialog that asks first says so; this is the half that carries it out.
 *
 * The surface takes this as a parameter rather than reaching for it, so that a screen
 * with nothing behind it simply does not offer the action. That is why it is written here
 * beside the rest of the server module and handed in, and why `lib` may not reach into an
 * app to find it.
 *
 * Answers true only when the server said it is gone. Every refusal is false: what a
 * reader does next is the same whichever it was - the project is still there - and the
 * sentence for it belongs to the dialog, in their own language, rather than to an English
 * detail from whoever runs the server.
 */
export async function forgetServerProject(
    remoteOrigin: string,
    project: VcsServerProject,
): Promise<boolean> {
    const answer = await forgetProject(remoteOrigin, project.id);
    return answer.ok;
}
