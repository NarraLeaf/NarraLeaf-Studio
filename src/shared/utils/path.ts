/**
 * Browser-compatible path module polyfill
 * Provides Node.js path API compatibility for renderer process
 */

export interface ParsedPath {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
}

export class PathError extends TypeError {
    public code?: string;
    constructor(message: string, code?: string) {
        super(message);
        this.code = code || 'ERR_INVALID_ARG_TYPE';
        this.name = 'TypeError';
    }
}

class PathPolyfill {
    private readonly isWindows: boolean;
    public readonly sep: string;
    public readonly delimiter: string;

    constructor(isWindows: boolean = false) {
        this.isWindows = isWindows;
        this.sep = isWindows ? '\\' : '/';
        this.delimiter = isWindows ? ';' : ':';
    }

    /**
     * Resolves a sequence of paths into an absolute path
     */
    resolve(...paths: string[]): string {
        let resolvedPath = '';
        let resolvedAbsolute = false;

        for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i--) {
            let path: string;
            if (i >= 0) {
                path = paths[i];
            } else if (this.isWindows) {
                path = process.cwd();
            } else {
                path = '/';
            }

            if (path === '') continue;

            if (this.isAbsolute(path)) {
                resolvedPath = path;
                resolvedAbsolute = true;
            } else {
                resolvedPath = this.join(resolvedPath, path);
            }
        }

        // Normalize the path
        resolvedPath = this.normalize(resolvedPath);

        // If still not absolute and we have a root, add it
        if (!resolvedAbsolute && this.isWindows) {
            const cwd = process.cwd();
            const root = this.parse(cwd).root;
            resolvedPath = this.join(root, resolvedPath);
        }

        return resolvedPath;
    }

    /**
     * Joins all given path segments together
     */
    join(...paths: string[]): string {
        if (paths.length === 0) return '.';

        let joined: string;
        if (this.isAbsolute(paths[0])) {
            joined = paths[0];
        } else {
            joined = paths[0] || '.';
        }

        for (let i = 1; i < paths.length; i++) {
            const path = paths[i];
            if (path === '') continue;

            if (path === undefined || path === null) {
                throw new PathError('Path must be a string. Received ' + path);
            }

            if (this.isAbsolute(path)) {
                joined = path;
            } else {
                // Remove leading separator from path if joined ends with separator
                const normalizedPath = joined.endsWith(this.sep) ? path : path;
                joined = joined + this.sep + normalizedPath;
            }
        }

        return this.normalize(joined);
    }

    /**
     * Returns the directory name of a path
     */
    dirname(path: string): string {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        const parsed = this.parse(path);
        return parsed.dir || '.';
    }

    /**
     * Returns the last portion of a path
     */
    basename(path: string, ext?: string): string {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        const parsed = this.parse(path);

        if (ext !== undefined && parsed.ext === ext) {
            return parsed.name;
        }

        return parsed.base;
    }

    /**
     * Returns the extension of the path
     */
    extname(path: string): string {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        return this.parse(path).ext;
    }

    /**
     * Parse a path into its components
     */
    parse(path: string): ParsedPath {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        // Handle empty string
        if (path === '') {
            return {
                root: '',
                dir: '',
                base: '',
                ext: '',
                name: ''
            };
        }

        // Handle root
        let root = '';
        if (this.isAbsolute(path)) {
            if (this.isWindows && path.startsWith('\\\\')) {
                // UNC path
                root = '\\\\';
            } else {
                root = path.substring(0, path.indexOf(this.sep) + 1);
                if (root === '' && this.isWindows) {
                    // Drive letter
                    root = path.substring(0, 3);
                }
            }
        }

        // Find last separator
        const lastSepIndex = path.lastIndexOf(this.sep);

        // Handle base and dir
        let base = '';
        let dir = '';
        let name = '';
        let ext = '';

        if (lastSepIndex === -1) {
            // No separators
            base = path;
        } else if (lastSepIndex === path.length - 1) {
            // Path ends with separator
            dir = path;
        } else {
            base = path.substring(lastSepIndex + 1);
            dir = path.substring(0, lastSepIndex);
        }

        // Parse base into name and ext
        const lastDotIndex = base.lastIndexOf('.');
        if (lastDotIndex > 0) {
            name = base.substring(0, lastDotIndex);
            ext = base.substring(lastDotIndex);
        } else {
            name = base;
            ext = '';
        }

        return { root, dir, base, ext, name };
    }

    /**
     * Format a path object into a path string
     */
    format(pathObject: ParsedPath): string {
        if (pathObject === null || typeof pathObject !== 'object') {
            throw new PathError('Path object must be an object');
        }

        let path = '';

        // Root
        if (pathObject.root) {
            path += pathObject.root;
        }

        // Dir
        if (pathObject.dir) {
            path += pathObject.dir;
            if (!pathObject.root && !path.endsWith(this.sep)) {
                path += this.sep;
            }
        }

        // Base (name + ext)
        if (pathObject.base) {
            path += pathObject.base;
        } else if (pathObject.name) {
            path += pathObject.name;
            if (pathObject.ext) {
                path += pathObject.ext;
            }
        }

        return path;
    }

    /**
     * Normalize a path
     */
    normalize(path: string): string {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        if (path === '') return '.';

        // Handle Windows drive letters
        const isWindowsPath = this.isWindows && /^[A-Za-z]:/.test(path);

        // Split into segments
        let segments = path.split(this.sep);

        // Process segments
        const result: string[] = [];

        for (const segment of segments) {
            if (segment === '' || segment === '.') {
                continue;
            } else if (segment === '..') {
                if (result.length > 0 && result[result.length - 1] !== '..') {
                    result.pop();
                } else if (!isWindowsPath) {
                    result.push(segment);
                }
            } else {
                result.push(segment);
            }
        }

        // Handle Windows drive letters
        if (isWindowsPath && segments[0].endsWith(':')) {
            result.unshift(segments[0]);
        }

        return result.join(this.sep) || '.';
    }

    /**
     * Check if path is absolute
     */
    isAbsolute(path: string): boolean {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        if (this.isWindows) {
            return /^[A-Za-z]:/.test(path) || path.startsWith('\\\\');
        } else {
            return path.startsWith('/');
        }
    }

    /**
     * Get relative path from one absolute path to another
     */
    relative(from: string, to: string): string {
        if (from === undefined || from === null || to === undefined || to === null) {
            throw new PathError('Path must be a string. Received ' + (from || to));
        }

        from = this.resolve(from);
        to = this.resolve(to);

        if (from === to) return '';

        // Split paths into segments
        const fromSegments = from.split(this.sep).filter(s => s !== '');
        const toSegments = to.split(this.sep).filter(s => s !== '');

        // Find common prefix
        let commonIndex = 0;
        while (commonIndex < fromSegments.length && commonIndex < toSegments.length &&
               fromSegments[commonIndex] === toSegments[commonIndex]) {
            commonIndex++;
        }

        // Build relative path
        const relativeSegments: string[] = [];

        // Add .. for each remaining segment in from
        for (let i = commonIndex; i < fromSegments.length; i++) {
            relativeSegments.push('..');
        }

        // Add remaining segments from to
        for (let i = commonIndex; i < toSegments.length; i++) {
            relativeSegments.push(toSegments[i]);
        }

        return relativeSegments.join(this.sep) || '.';
    }

    /**
     * Get platform-specific path implementation
     */
    getPlatformPath(): PathPolyfill {
        if (typeof process !== 'undefined' && process.platform === 'win32') {
            return win32;
        }
        return posix;
    }
}

// Create platform singletons and default instance (auto-detect platform)
const win32 = new PathPolyfill(true);
const posix = new PathPolyfill(false);
const defaultPath = (typeof process !== 'undefined' && process.platform === 'win32') ? win32 : posix;

// Export commonly used functions
export const resolve = (...paths: string[]) => defaultPath.resolve(...paths);
export const join = (...paths: string[]) => defaultPath.join(...paths);
export const dirname = (path: string) => defaultPath.dirname(path);
export const basename = (path: string, ext?: string) => defaultPath.basename(path, ext);
export const extname = (path: string) => defaultPath.extname(path);
export const parse = (path: string) => defaultPath.parse(path);
export const format = (pathObject: ParsedPath) => defaultPath.format(pathObject);
export const normalize = (path: string) => defaultPath.normalize(path);
export const isAbsolute = (path: string) => defaultPath.isAbsolute(path);
export const relative = (from: string, to: string) => defaultPath.relative(from, to);

// Export platform-specific implementations
export { win32, posix };

// Export constants
export const sep = defaultPath.sep;
export const delimiter = defaultPath.delimiter;

// Export default instance
export default defaultPath;
