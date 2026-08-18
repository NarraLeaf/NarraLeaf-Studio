import fs from "fs/promises";
import path from "path";
import { dialog } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import {
  PROJECT_PACKAGE_EXTENSION,
  PROJECT_PACKAGE_FORMAT,
  PROJECT_PACKAGE_FORMAT_VERSION,
  ProjectPackagePayload,
  decodeProjectPackage,
  encodeProjectPackage,
  normalizeProjectPackagePath,
  shouldExcludeProjectPackagePath
} from "@shared/utils/projectPackage";
import {
  decodeProjectConfig,
  findProjectConfigFileName,
  sanitizeProjectFileName
} from "@shared/utils/nlproj";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

type ProjectMetadata = {
  name: string;
  identifier?: string;
};

export class WorkspaceExportProjectPackageHandler extends IPCHandler<IPCEventType.workspaceExportProjectPackage> {
  readonly name = IPCEventType.workspaceExportProjectPackage;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { projectPath }: IPCEvents[IPCEventType.workspaceExportProjectPackage]["data"]
  ): Promise<RequestStatus<IPCEvents[IPCEventType.workspaceExportProjectPackage]["response"]>> {
    try {
      const projectRoot = path.resolve(projectPath);
      if (!(await window.app.storageManager.isPathAllowed(window, projectRoot, "read"))) {
        return this.failed(`File system access is not allowed for project: ${projectRoot}`);
      }

      const project = await readProjectMetadata(projectRoot);
      const selection = await dialog.showOpenDialog(window.win, {
        title: "Select Export Folder",
        buttonLabel: "Export Here",
        properties: ["openDirectory", "createDirectory"],
        securityScopedBookmarks: true
      });

      if (selection.canceled || selection.filePaths.length === 0) {
        return this.success({ canceled: true });
      }

      const exportDir = path.resolve(selection.filePaths[0]);
      if (await window.app.storageManager.isPathProtected(exportDir)) {
        return this.failed("Selected export folder is inside protected Studio storage.");
      }
      window.app.storageManager.grantFileSystemAccess(
        window,
        exportDir,
        "readwrite",
        true,
        selection.bookmarks?.[0],
        "session"
      );
      if (!(await window.app.storageManager.isPathAllowed(window, exportDir, "write"))) {
        return this.failed(`File system access is not allowed for export folder: ${exportDir}`);
      }

      const { payload, skippedCount } = await collectProjectPackagePayload(projectRoot, project);
      const packageBytes = encodeProjectPackage(payload);
      const packagePath = await resolveAvailablePackagePath(exportDir, project.name);
      await fs.writeFile(packagePath, packageBytes, { flag: "wx" });

      return this.success({
        canceled: false,
        packagePath,
        fileCount: payload.files.length,
        byteLength: packageBytes.byteLength,
        skippedCount
      });
    } catch (error) {
      return this.failed(error);
    }
  }
}

/**
 * Unpack a package the caller already chose, into a folder the caller already chose.
 *
 * **It puts up no dialogs.** It used to put up two, back to back, which meant the wizard page in
 * front of them could not say what had been picked, could not check the folder was empty before
 * committing to it, and could not let the author change one of the two answers without starting
 * over. The picking now happens on that page, one button each.
 *
 * Neither path is granted here. Both pickers grant on the way out, so a path this window was never
 * handed fails the checks below - which is what keeps a renderer-supplied path from being a way to
 * read anywhere on the disk.
 */
export class WorkspaceImportProjectPackageHandler extends IPCHandler<IPCEventType.workspaceImportProjectPackage> {
  readonly name = IPCEventType.workspaceImportProjectPackage;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { packagePath, targetDir }: IPCEvents[IPCEventType.workspaceImportProjectPackage]["data"]
  ): Promise<RequestStatus<IPCEvents[IPCEventType.workspaceImportProjectPackage]["response"]>> {
    try {
      const resolvedPackage = path.resolve(packagePath);
      if (!(await window.app.storageManager.isPathAllowed(window, resolvedPackage, "read"))) {
        return this.failed(`File system access is not allowed for package: ${resolvedPackage}`);
      }

      const resolvedTarget = path.resolve(targetDir);
      if (await window.app.storageManager.isPathProtected(resolvedTarget)) {
        return this.failed("Selected import folder is inside protected Studio storage.");
      }
      if (!(await window.app.storageManager.isPathAllowed(window, resolvedTarget, "write"))) {
        return this.failed(
          `File system access is not allowed for import folder: ${resolvedTarget}`
        );
      }

      const result = await importProjectPackage(resolvedPackage, resolvedTarget);
      return this.success({
        projectPath: resolvedTarget,
        projectName: result.projectName,
        fileCount: result.fileCount,
        byteLength: result.byteLength
      });
    } catch (error) {
      return this.failed(error);
    }
  }
}

/**
 * The `.nlspkg` file picker, and the grant that makes the path it returns usable.
 *
 * Lives with the wizard's directory picker rather than with the import handler, because it is the
 * same kind of thing: a native dialog whose only job is to turn a click into a path this window is
 * allowed to touch.
 */
export class ProjectWizardSelectPackageHandler extends IPCHandler<IPCEventType.projectWizardSelectPackage> {
  readonly name = IPCEventType.projectWizardSelectPackage;
  readonly type = IPCMessageType.request;

  public async handle(window: AppWindow): Promise<RequestStatus<{ dest: string | null }>> {
    const selection = await dialog.showOpenDialog(window.win, {
      title: "Select Project Package",
      buttonLabel: "Select Package",
      properties: ["openFile"],
      filters: [
        {
          name: "NarraLeaf Studio Project Package",
          extensions: [PROJECT_PACKAGE_EXTENSION.slice(1)]
        },
        { name: "All Files", extensions: ["*"] }
      ],
      securityScopedBookmarks: true
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return this.success({ dest: null });
    }

    const packagePath = path.resolve(selection.filePaths[0]);
    // Read, not readwrite, and not recursive: this is one file that gets copied out of.
    window.app.storageManager.grantFileSystemAccess(
      window,
      packagePath,
      "read",
      false,
      selection.bookmarks?.[0],
      "session"
    );
    return this.success({ dest: packagePath });
  }
}

async function readProjectMetadata(projectRoot: string): Promise<ProjectMetadata> {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const configFileName = findProjectConfigFileName(
    entries.map((entry) => ({
      name: path.parse(entry.name).name,
      ext: path.extname(entry.name) || null,
      type: entry.isDirectory() ? "directory" : "file"
    }))
  );

  if (!configFileName) {
    return { name: path.basename(projectRoot) || "project" };
  }

  const configPath = path.join(projectRoot, configFileName);
  if (configFileName.endsWith(".nlproj")) {
    const config = decodeProjectConfig(await fs.readFile(configPath));
    return {
      name: config.name || path.basename(projectRoot) || "project",
      identifier: typeof config.identifier === "string" ? config.identifier : undefined
    };
  }

  const raw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(raw) as { name?: string; identifier?: string };
  return {
    name: config.name || path.basename(projectRoot) || "project",
    identifier: typeof config.identifier === "string" ? config.identifier : undefined
  };
}

async function collectProjectPackagePayload(
  projectRoot: string,
  project: ProjectMetadata
): Promise<{ payload: ProjectPackagePayload; skippedCount: number }> {
  const directories = new Set<string>();
  const files: ProjectPackagePayload["files"] = [];
  let skippedCount = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toProjectPackagePath(projectRoot, absolutePath);

      if (entry.isSymbolicLink() || shouldExcludeProjectPackagePath(relativePath)) {
        skippedCount += 1;
        continue;
      }

      if (entry.isDirectory()) {
        directories.add(relativePath);
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push({
          path: relativePath,
          data: await fs.readFile(absolutePath)
        });
        continue;
      }

      skippedCount += 1;
    }
  }

  await walk(projectRoot);

  return {
    skippedCount,
    payload: {
      format: PROJECT_PACKAGE_FORMAT,
      version: PROJECT_PACKAGE_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      projectName: project.name,
      projectIdentifier: project.identifier,
      directories: Array.from(directories).sort(),
      files: files.sort((a, b) => a.path.localeCompare(b.path))
    }
  };
}

async function importProjectPackage(
  packagePath: string,
  targetDir: string
): Promise<{
  projectName: string;
  fileCount: number;
  byteLength: number;
}> {
  await fs.mkdir(targetDir, { recursive: true });
  const existing = await fs.readdir(targetDir);
  if (existing.length > 0) {
    throw new Error(
      "Import folder must be empty. Choose an empty folder for the imported project."
    );
  }

  const packageBytes = await fs.readFile(packagePath);
  const payload = decodeProjectPackage(packageBytes);

  for (const directory of payload.directories) {
    await fs.mkdir(resolveInsideTarget(targetDir, directory), { recursive: true });
  }

  for (const file of payload.files) {
    const filePath = resolveInsideTarget(targetDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.data, { flag: "wx" });
  }

  return {
    projectName: payload.projectName,
    fileCount: payload.files.length,
    byteLength: packageBytes.byteLength
  };
}

async function resolveAvailablePackagePath(
  exportDir: string,
  projectName: string
): Promise<string> {
  const baseName = sanitizeProjectFileName(projectName);
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = path.join(exportDir, `${baseName}${suffix}${PROJECT_PACKAGE_EXTENSION}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Unable to choose a unique package filename in the selected folder.");
}

function toProjectPackagePath(projectRoot: string, absolutePath: string): string {
  const relativePath = path.relative(projectRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside project root: ${absolutePath}`);
  }
  return normalizeProjectPackagePath(relativePath);
}

function resolveInsideTarget(targetDir: string, packagePath: string): string {
  const relativePath = normalizeProjectPackagePath(packagePath);
  const resolved = path.resolve(targetDir, ...relativePath.split("/"));
  const relativeToTarget = path.relative(targetDir, resolved);
  if (relativeToTarget.startsWith("..") || path.isAbsolute(relativeToTarget)) {
    throw new Error(`Project package path escapes import folder: ${packagePath}`);
  }
  return resolved;
}
