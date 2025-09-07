/**
 * Repository scanning functionality for discovering and processing TypeScript files
 */

import fs from 'fs';
import path from 'path';
import { ScanOptions, ProcessingError, ProcessingStats, ErrorType } from './types';

/**
 * Recursively discovers TypeScript files in a repository directory.
 * Handles symbolic links and permission errors gracefully.
 * 
 * @param rootPath - The root directory to scan
 * @param extensions - Array of file extensions to include (e.g., ['.ts', '.tsx'])
 * @param excludePatterns - Array of glob-like patterns to exclude
 * @returns Promise resolving to array of discovered file paths
 */
export async function discoverFiles(
    rootPath: string,
    extensions: string[],
    excludePatterns: string[] = []
): Promise<string[]> {
    const discoveredFiles: string[] = [];
    const errors: ProcessingError[] = [];

    /**
     * Recursively traverses directories to find matching files
     */
    async function traverseDirectory(currentPath: string): Promise<void> {
        try {
            // Check if path should be excluded
            if (shouldExcludePath(currentPath, rootPath, excludePatterns)) {
                return;
            }

            const stats = await fs.promises.lstat(currentPath);

            if (stats.isSymbolicLink()) {
                // Handle symbolic links - resolve and check if target exists
                try {
                    const realPath = await fs.promises.realpath(currentPath);
                    const realStats = await fs.promises.stat(realPath);
                    
                    if (realStats.isDirectory()) {
                        // Recursively process symbolic link to directory
                        await traverseDirectory(realPath);
                    } else if (realStats.isFile() && hasMatchingExtension(realPath, extensions)) {
                        discoveredFiles.push(currentPath); // Keep original symlink path
                    }
                } catch (symlinkError) {
                    // Broken symbolic link - log but continue
                    errors.push({
                        type: 'file_system' as ErrorType,
                        filePath: currentPath,
                        message: `Broken symbolic link: ${symlinkError instanceof Error ? symlinkError.message : String(symlinkError)}`,
                        recoverable: true,
                        timestamp: new Date()
                    });
                }
            } else if (stats.isDirectory()) {
                // Process directory contents
                try {
                    const entries = await fs.promises.readdir(currentPath);
                    
                    // Process entries in parallel for better performance
                    const traversalPromises = entries.map(entry => {
                        const entryPath = path.join(currentPath, entry);
                        return traverseDirectory(entryPath);
                    });
                    
                    await Promise.all(traversalPromises);
                } catch (dirError) {
                    // Permission denied or other directory access error
                    errors.push({
                        type: 'file_system' as ErrorType,
                        filePath: currentPath,
                        message: `Cannot read directory: ${dirError instanceof Error ? dirError.message : String(dirError)}`,
                        recoverable: true,
                        timestamp: new Date()
                    });
                }
            } else if (stats.isFile() && hasMatchingExtension(currentPath, extensions)) {
                // Regular file with matching extension
                discoveredFiles.push(currentPath);
            }
        } catch (error) {
            // General file system error (permission denied, etc.)
            errors.push({
                type: 'file_system' as ErrorType,
                filePath: currentPath,
                message: `File system error: ${error instanceof Error ? error.message : String(error)}`,
                recoverable: true,
                timestamp: new Date()
            });
        }
    }

    // Start traversal from root path
    await traverseDirectory(rootPath);

    // Log errors if any occurred (but don't throw - we want to continue processing)
    if (errors.length > 0) {
        console.warn(`File discovery encountered ${errors.length} errors:`);
        errors.forEach(error => {
            console.warn(`  ${error.filePath}: ${error.message}`);
        });
    }

    return discoveredFiles.sort(); // Sort for consistent ordering
}

/**
 * Checks if a file has one of the specified extensions.
 * 
 * @param filePath - Path to the file
 * @param extensions - Array of extensions to match (including the dot)
 * @returns True if file has matching extension
 */
function hasMatchingExtension(filePath: string, extensions: string[]): boolean {
    const fileExtension = path.extname(filePath).toLowerCase();
    return extensions.some(ext => ext.toLowerCase() === fileExtension);
}

/**
 * Determines if a path should be excluded based on exclude patterns.
 * Supports basic glob-like patterns and common exclusions.
 * 
 * @param currentPath - The path to check
 * @param rootPath - The root path being scanned
 * @param excludePatterns - Array of patterns to exclude
 * @returns True if path should be excluded
 */
function shouldExcludePath(currentPath: string, rootPath: string, excludePatterns: string[]): boolean {
    // Get relative path from root for pattern matching
    const relativePath = path.relative(rootPath, currentPath);
    
    // Default exclusions for common directories that should be skipped
    const defaultExclusions = [
        'node_modules',
        '.git',
        '.svn',
        '.hg',
        'dist',
        'build',
        'coverage',
        '.nyc_output',
        'tmp',
        'temp'
    ];
    
    // Check if any path component matches default exclusions
    const pathComponents = relativePath.split(path.sep);
    for (const component of pathComponents) {
        if (defaultExclusions.includes(component)) {
            return true;
        }
    }
    
    // Check against user-provided exclude patterns
    for (const pattern of excludePatterns) {
        if (matchesPattern(relativePath, pattern)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Simple pattern matching for exclude patterns.
 * Supports basic glob-like patterns with * and **.
 * 
 * @param path - The path to test
 * @param pattern - The pattern to match against
 * @returns True if path matches pattern
 */
function matchesPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    // This is a simplified implementation - could be enhanced with a proper glob library
    
    // Escape special regex characters except * and **
    let regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
        .replace(/\*\*/g, '___DOUBLESTAR___') // Temporarily replace **
        .replace(/\*/g, '[^/\\\\]*') // * matches anything except path separators
        .replace(/___DOUBLESTAR___/g, '.*'); // ** matches anything including path separators
    
    // Add anchors for exact matching
    regexPattern = '^' + regexPattern + '$';
    
    const regex = new RegExp(regexPattern, 'i'); // Case insensitive
    return regex.test(path.replace(/\\/g, '/')); // Normalize path separators
}

/**
 * Scans a repository for supported files with the given options.
 * This is the main entry point for repository file discovery.
 * 
 * @param options - Scanning configuration options
 * @returns Promise resolving to array of discovered file paths
 */
export async function scanRepository(options: ScanOptions): Promise<string[]> {
    const { rootPath, extensions, excludePatterns } = options;
    
    // Validate root path exists
    try {
        const stats = await fs.promises.stat(rootPath);
        if (!stats.isDirectory()) {
            throw new Error(`Root path is not a directory: ${rootPath}`);
        }
    } catch (error) {
        throw new Error(`Cannot access root path ${rootPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Discover files
    const files = await discoverFiles(rootPath, extensions, excludePatterns);
    
    return files;
}

/**
 * Creates default scan options for TypeScript repositories.
 * 
 * @param rootPath - The repository root path
 * @returns ScanOptions with sensible defaults for TypeScript projects
 */
export function createDefaultScanOptions(rootPath: string): ScanOptions {
    return {
        rootPath,
        extensions: ['.ts', '.tsx'],
        excludePatterns: [
            '**/*.d.ts',        // Type definition files
            '**/*.test.ts',     // Test files (optional - could be included)
            '**/*.test.tsx',    // Test files (optional - could be included)
            '**/*.spec.ts',     // Spec files (optional - could be included)
            '**/*.spec.tsx',    // Spec files (optional - could be included)
            '**/dist/**',       // Distribution directory
            '**/build/**',      // Build directory
            '**/coverage/**',   // Coverage reports
            '**/.next/**',      // Next.js build directory
            '**/.nuxt/**',      // Nuxt.js build directory
        ]
    };
}