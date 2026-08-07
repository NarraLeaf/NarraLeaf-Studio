/**
 * Browser-compatible path module polyfill
 * Provides Node.js path API compatibility for renderer process
 *
 * Two separators go in, one comes out. Windows reads `/` and `\` as the same character - and this
 * polyfill is fed both, constantly: a project on a Windows machine resolves to
 * `D:/proj\runtimes/puppet`, and a model bundle names its own files `Hiyori.2048/texture_00.png`.
 * Parsing against a single stored separator meant `basename("a/b.png")` answered `"a/b.png"` and
 * `dirname` answered `"."`, silently, for every such path.
 *
 * Where it deliberately parts from `path.win32`: the separator it *writes* is the one the input
 * already used, not the platform's. `join("/Users/nomen/x", "y.nlproj")` keeps its forward slashes
 * rather than being rewritten into a Windows path it never was.
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
    /** Every character this platform accepts as a separator when *reading* a path. */
    private readonly separators: readonly string[];
    /** Splits on any accepted separator. Not global, so `exec` stays stateless. */
    private readonly separatorPattern: RegExp;

    constructor(isWindows: boolean = false) {
        this.isWindows = isWindows;
        this.sep = isWindows ? '\\' : '/';
        this.delimiter = isWindows ? ';' : ':';
        // POSIX does not read `\` as a separator: it is a legal character in a file name there.
        this.separators = isWindows ? ['\\', '/'] : ['/'];
        this.separatorPattern = isWindows ? /[\\/]/ : /\//;
    }

    /** Whether `char` separates path segments on this platform. */
    private isSeparator(char: string | undefined): boolean {
        return char !== undefined && this.separators.includes(char);
    }

    private endsWithSeparator(path: string): boolean {
        return path.length > 0 && this.isSeparator(path[path.length - 1]);
    }

    private lastSeparatorIndex(path: string): number {
        for (let i = path.length - 1; i >= 0; i--) {
            if (this.isSeparator(path[i])) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Which separator to *write*.
     *
     * The first one the input already uses wins; only a path carrying none at all falls back to the
     * platform's. Rewriting `/Users/nomen/x` into `\Users\nomen\x` because the editor happens to run
     * on Windows would corrupt a path that was never a Windows path.
     */
    private preferredSeparator(...paths: string[]): string {
        if (!this.isWindows) {
            return '/';
        }
        for (const path of paths) {
            if (typeof path !== 'string') {
                continue;
            }
            const match = this.separatorPattern.exec(path);
            if (match) {
                return match[0];
            }
        }
        return this.sep;
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
                resolvedPath = this.join(path, resolvedPath);
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

        // Decided over every segment before any of them is written, so that the separator this
        // inserts cannot be the one that later decides the style (`join("project", "/editor")`).
        const sep = this.preferredSeparator(...paths);
        let joined = '';

        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            if (path === undefined || path === null) {
                throw new PathError('Path must be a string. Received ' + path);
            }
            if (path === '') continue;

            if (joined === '') {
                joined = path;
            } else {
                const normalizedPath = this.stripLeadingSeparators(path);
                joined = joined + (this.endsWithSeparator(joined) ? '' : sep) + normalizedPath;
            }
        }

        return this.normalize(joined || '.');
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

        const root = this.rootOf(path);

        // Find last separator, counting either kind
        const lastSepIndex = this.lastSeparatorIndex(path);

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
            // `/Mao` and `D:\Mao` sit *in* their root, so the root separator belongs to the
            // directory; cutting at the last separator would leave `""` and `"D:"`.
            if (dir.length < root.length) {
                dir = root;
            }
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
     * The leading portion a path cannot be walked out of: `/`, `//`, `D:\`, `D:`, or nothing.
     *
     * Reported with the separator the caller wrote, not the platform's, so it stays a prefix of the
     * path it came from - `parse("D:/x").root` is `"D:/"`.
     */
    private rootOf(path: string): string {
        if (!this.isAbsolute(path)) {
            return '';
        }
        if (!this.isWindows) {
            return '/';
        }
        if (this.isSeparator(path[0])) {
            // A leading pair of separators is a UNC root; a lone one is rooted on the current drive.
            return this.isSeparator(path[1]) ? path.substring(0, 2) : path.substring(0, 1);
        }
        // Drive letter. Rooted only when a separator follows: `D:x` is relative to the drive's own
        // working directory, so its root is the bare drive.
        return this.isSeparator(path[2]) ? path.substring(0, 3) : path.substring(0, 2);
    }

    /**
     * Format a path object into a path string
     */
    format(pathObject: ParsedPath): string {
        if (pathObject === null || typeof pathObject !== 'object') {
            throw new PathError('Path object must be an object');
        }

        let path = '';
        // The inverse of `parse`, so it writes back the style `parse` read.
        const sep = this.preferredSeparator(pathObject.dir ?? '', pathObject.root ?? '');

        // Root
        if (pathObject.root) {
            path += pathObject.root;
        }

        // Dir
        if (pathObject.dir) {
            path += pathObject.dir;
            if (!pathObject.root && !this.endsWithSeparator(path)) {
                path += sep;
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

        const sep = this.preferredSeparator(path);
        const isAbsolutePath = this.isAbsolute(path);
        const hasTrailingSeparator = path.length > 1 && this.endsWithSeparator(path);

        // Handle Windows drive letters
        const isWindowsPath = this.isWindows && /^[A-Za-z]:/.test(path);
        const isUncPath = this.isWindows && this.isSeparator(path[0]) && this.isSeparator(path[1]);

        // Split into segments
        const segments = path.split(this.separatorPattern);

        // Process segments
        const result: string[] = [];

        for (const segment of segments) {
            if (segment === '' || segment === '.') {
                continue;
            } else if (segment === '..') {
                if (result.length > 0 && result[result.length - 1] !== '..') {
                    result.pop();
                } else if (!isAbsolutePath && !isWindowsPath) {
                    result.push(segment);
                }
            } else {
                result.push(segment);
            }
        }

        // Handle Windows drive letters
        if (isWindowsPath && segments[0].endsWith(':')) {
            // Avoid duplicating the drive letter if it has already been added
            if (result.length === 0 || result[0] !== segments[0]) {
                result.unshift(segments[0]);
            }
        }

        let normalized = result.join(sep);

        if (isAbsolutePath) {
            if (isUncPath) {
                normalized = sep + sep + normalized;
            } else if (isWindowsPath) {
                // The drive already leads `result`. Only `D:\..`, collapsed to the bare drive, has
                // lost the separator that made it a root.
                if (result.length === 1 && this.isSeparator(path[2])) {
                    normalized += sep;
                }
            } else {
                // A POSIX root - including one typed on Windows, which `path.win32` also keeps.
                normalized = sep + normalized;
            }
        }

        if (!normalized) {
            return isAbsolutePath ? sep : '.';
        }

        if (hasTrailingSeparator && normalized !== sep && !this.endsWithSeparator(normalized)) {
            normalized += sep;
        }

        return normalized;
    }

    /**
     * Check if path is absolute
     */
    isAbsolute(path: string): boolean {
        if (path === undefined || path === null) {
            throw new PathError('Path must be a string. Received ' + path);
        }

        if (this.isWindows) {
            // A leading separator of either kind is a root, the way `path.win32` reads it. Dropping
            // that is what turned every POSIX path handed to a Windows editor into a relative one.
            return /^[A-Za-z]:/.test(path) || this.isSeparator(path[0]);
        } else {
            return path.startsWith('/');
        }
    }

    private stripLeadingSeparators(path: string): string {
        if (this.isWindows) {
            return path.replace(/^[\\/]+/, '');
        }
        return path.replace(/^\/+/, '');
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

        const sep = this.preferredSeparator(from, to);

        // Split paths into segments
        const fromSegments = from.split(this.separatorPattern).filter(s => s !== '');
        const toSegments = to.split(this.separatorPattern).filter(s => s !== '');

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

        return relativeSegments.join(sep) || '.';
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

// Enhanced platform detection: works in Node, Electron renderer, and browser bundles
function detectIsWindows(): boolean {
    if (typeof process !== 'undefined' && typeof process.platform === 'string') {
        return process.platform === 'win32';
    }
    // Fallback for browser-like environments
    if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
        return /windows|win32/i.test(navigator.userAgent);
    }
    return false;
}

/**
 * Whether this process is looking at a Windows filesystem, by the same detection the default
 * instance below uses. Exported because the answer decides more than which separator to write:
 * on Windows two spellings of one path are the same path, which is what project identity turns
 * on (see `normalizeProjectPath`).
 */
export const isWindowsPlatform = detectIsWindows();

const defaultPath = isWindowsPlatform ? win32 : posix;

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
