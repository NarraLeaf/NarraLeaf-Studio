// Context exports. Only the hooks: they are read by code that also runs in the Dev Mode window, and
// the provider's module imports the whole workspace. WorkSpaceApp imports the provider directly.
export { useWorkspace, useOptionalWorkspace } from "./workspaceContextHandle";
