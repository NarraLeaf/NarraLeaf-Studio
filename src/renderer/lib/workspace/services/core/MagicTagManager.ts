import { extname } from "@shared/utils/path";

/**
 * Magic tag generation template for batch tagging assets
 */
export interface MagicTagTemplate {
    // Example filename (the one with most segments)
    example: string;
    
    // Segments extracted from the example file
    exampleSegments: string[];
    
    // Mode: auto-detect or regex
    mode: 'auto' | 'regex';
    
    // Auto mode: detected delimiters with statistics
    delimiters?: DelimiterInfo[];
    
    // Regex mode: pattern and named capture groups
    regex?: {
        pattern: string;
        captureGroups: string[];
    };
    
    // All files' segments (for statistics and preview)
    // fileSegments[i] = segments of file i
    fileSegments: string[][];
    
    // Original filenames (without extension)
    filenames: string[];
}

/**
 * Delimiter information with statistics
 */
export interface DelimiterInfo {
    char: string;
    count: number;        // Total occurrences across all files
    frequency: number;    // Frequency in files (0-1)
}

/**
 * Tag generation preview based on user's category mapping
 */
export interface MagicTagPreview {
    filename: string;
    tags: string[];  // Generated tags in format "category:value"
}

/**
 * Manager for magic tag generation from filename patterns
 */
export class MagicTagManager {
    // Common delimiters including CJK variants
    private static readonly COMMON_DELIMITERS = [
        '-',   // Hyphen
        '_',   // Underscore
        '.',   // Dot
        ' ',   // Space
        '·',   // Middle dot (Chinese)
        '・',  // Middle dot (Japanese)
        '｜',  // Full-width vertical bar
        '丨',   // CJK vertical line
        '－',  // Full-width hyphen
        '＿',  // Full-width underscore
    ];

    /**
     * Analyze filenames and generate a magic tag template (auto-detect mode)
     * @param filenames Array of filenames to analyze
     * @returns Magic tag template with detected delimiters
     */
    public static analyzeFilenames(filenames: string[]): MagicTagTemplate {
        if (filenames.length === 0) {
            throw new Error('No filenames provided for analysis');
        }

        // Step 1: Remove extensions and clean filenames
        const cleanedNames = filenames.map(f => this.removeExtension(f).trim());

        // Step 2: Detect delimiters across all files
        const delimiters = this.detectDelimiters(cleanedNames);

        if (delimiters.length === 0) {
            // No delimiters found, treat each filename as a single segment
            return {
                example: cleanedNames[0],
                exampleSegments: [cleanedNames[0]],
                mode: 'auto',
                delimiters: [],
                fileSegments: cleanedNames.map(name => [name]),
                filenames: cleanedNames,
            };
        }

        // Step 3: Split all filenames using detected delimiters
        const allSegments = cleanedNames.map(name => 
            this.splitByDelimiters(name, delimiters.map(d => d.char))
        );

        // Step 4: Find the file with most segments as example
        const maxSegments = Math.max(...allSegments.map(segs => segs.length));
        const exampleIndex = allSegments.findIndex(segs => segs.length === maxSegments);
        const example = cleanedNames[exampleIndex];
        const exampleSegments = allSegments[exampleIndex];

        return {
            example,
            exampleSegments,
            mode: 'auto',
            delimiters,
            fileSegments: allSegments,
            filenames: cleanedNames,
        };
    }

    /**
     * Analyze filenames using a regular expression (regex mode)
     * @param filenames Array of filenames to analyze
     * @param regexPattern Regular expression with named capture groups
     * @returns Magic tag template with regex pattern
     */
    public static analyzeWithRegex(
        filenames: string[],
        regexPattern: string
    ): MagicTagTemplate {
        if (filenames.length === 0) {
            throw new Error('No filenames provided for analysis');
        }

        // Step 1: Validate regex and extract capture group names
        const captureGroups = this.extractCaptureGroups(regexPattern);
        
        if (captureGroups.length === 0) {
            throw new Error('Regular expression must contain at least one named capture group. Example: (?<category>pattern)');
        }

        // Step 2: Remove extensions
        const cleanedNames = filenames.map(f => this.removeExtension(f).trim());

        // Step 3: Test regex against all files
        const regex = new RegExp(regexPattern, 'u');
        const allSegments: string[][] = [];
        let matchedCount = 0;

        for (const name of cleanedNames) {
            const match = regex.exec(name);
            if (match && match.groups) {
                // Extract values from named groups in order
                const segments = captureGroups.map(groupName => 
                    (match.groups![groupName] || '').trim()
                );
                allSegments.push(segments);
                matchedCount++;
            } else {
                // No match, use empty segments
                allSegments.push(captureGroups.map(() => ''));
            }
        }

        if (matchedCount === 0) {
            throw new Error('Regular expression did not match any filenames');
        }

        // Step 4: Find best example (most non-empty segments)
        const segmentCounts = allSegments.map(segs => 
            segs.filter(s => s.length > 0).length
        );
        const maxCount = Math.max(...segmentCounts);
        const exampleIndex = segmentCounts.findIndex(count => count === maxCount);
        const example = cleanedNames[exampleIndex];
        const exampleSegments = allSegments[exampleIndex];

        return {
            example,
            exampleSegments,
            mode: 'regex',
            regex: {
                pattern: regexPattern,
                captureGroups,
            },
            fileSegments: allSegments,
            filenames: cleanedNames,
        };
    }

    /**
     * Generate tag preview based on user's category mapping
     * @param template Magic tag template
     * @param categoryMapping Map from segment index to category name (e.g., {0: 'char', 2: 'emo'})
     * @returns Array of previews for each file
     */
    public static generatePreview(
        template: MagicTagTemplate,
        categoryMapping: Record<number, string>
    ): MagicTagPreview[] {
        const previews: MagicTagPreview[] = [];

        for (let i = 0; i < template.filenames.length; i++) {
            const filename = template.filenames[i];
            const segments = template.fileSegments[i];
            const tags: string[] = [];

            // Generate tags based on category mapping
            for (const [indexStr, category] of Object.entries(categoryMapping)) {
                const index = parseInt(indexStr, 10);
                if (index >= 0 && index < segments.length) {
                    const value = segments[index].trim();
                    if (value && category.trim()) {
                        tags.push(`${category.trim()}:${value}`);
                    }
                }
            }

            previews.push({ filename, tags });
        }

        return previews;
    }

    /**
     * Remove file extension from filename
     */
    private static removeExtension(filename: string): string {
        const ext = extname(filename);
        return ext ? filename.slice(0, -ext.length) : filename;
    }

    /**
     * Detect delimiters in filenames with statistics
     */
    private static detectDelimiters(filenames: string[]): DelimiterInfo[] {
        const delimiterStats = new Map<string, { count: number; fileCount: number }>();

        // Count delimiter occurrences
        for (const name of filenames) {
            const foundInFile = new Set<string>();
            
            for (const char of name) {
                if (this.COMMON_DELIMITERS.includes(char)) {
                    if (!delimiterStats.has(char)) {
                        delimiterStats.set(char, { count: 0, fileCount: 0 });
                    }
                    const stats = delimiterStats.get(char)!;
                    stats.count++;
                    
                    if (!foundInFile.has(char)) {
                        stats.fileCount++;
                        foundInFile.add(char);
                    }
                }
            }
        }

        // Convert to array and calculate frequency
        const delimiters: DelimiterInfo[] = [];
        for (const [char, stats] of delimiterStats.entries()) {
            delimiters.push({
                char,
                count: stats.count,
                frequency: stats.fileCount / filenames.length,
            });
        }

        // Sort by frequency (descending), then by count
        delimiters.sort((a, b) => {
            if (Math.abs(a.frequency - b.frequency) > 0.01) {
                return b.frequency - a.frequency;
            }
            return b.count - a.count;
        });

        return delimiters;
    }

    /**
     * Split filename by multiple delimiters
     */
    private static splitByDelimiters(filename: string, delimiters: string[]): string[] {
        if (delimiters.length === 0) {
            return [filename];
        }

        // Create regex pattern for splitting
        // Escape special regex characters
        const escapedDelimiters = delimiters.map(d => 
            d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
        const pattern = escapedDelimiters.join('|');
        const regex = new RegExp(pattern, 'g');

        // Split and filter out empty segments
        const segments = filename.split(regex)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        return segments;
    }

    /**
     * Extract named capture group names from regex pattern
     */
    private static extractCaptureGroups(pattern: string): string[] {
        const groups: string[] = [];
        
        // Match named capture groups: (?<name>...)
        const namedGroupRegex = /\(\?<(\w+)>/g;
        let match: RegExpExecArray | null;

        while ((match = namedGroupRegex.exec(pattern)) !== null) {
            groups.push(match[1]);
        }

        return groups;
    }
}

