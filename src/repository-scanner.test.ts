/**
 * Tests for repository scanning functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { discoverFiles, scanRepository, createDefaultScanOptions } from './repository-scanner';

// Test directory structure
const testDir = path.join(__dirname, 'test-repo');

describe('Repository Scanner', () => {
    beforeEach(async () => {
        // Create test directory structure
        await createTestRepository();
    });

    afterEach(async () => {
        // Clean up test directory
        await cleanupTestRepository();
    });

    describe('discoverFiles', () => {
        it('should discover TypeScript files recursively', async () => {
            const files = await discoverFiles(testDir, ['.ts', '.tsx'], []);
            
            expect(files).toContain(path.join(testDir, 'src', 'index.ts'));
            expect(files).toContain(path.join(testDir, 'src', 'components', 'Button.tsx'));
            expect(files).toContain(path.join(testDir, 'lib', 'utils.ts'));
        });

        it('should exclude files based on patterns', async () => {
            const files = await discoverFiles(testDir, ['.ts', '.tsx'], ['**/*.test.ts', '**/node_modules/**']);
            
            expect(files).not.toContain(path.join(testDir, 'src', 'index.test.ts'));
            expect(files).not.toContain(path.join(testDir, 'node_modules', 'package', 'index.ts'));
        });

        it('should handle permission errors gracefully', async () => {
            // This test would need special setup for permission testing
            // For now, just ensure the function doesn't throw
            const files = await discoverFiles('/nonexistent', ['.ts'], []);
            expect(Array.isArray(files)).toBe(true);
        });

        it('should exclude default directories', async () => {
            const files = await discoverFiles(testDir, ['.ts', '.tsx'], []);
            
            // Should not include files from node_modules, .git, dist, etc.
            const nodeModulesFiles = files.filter(f => f.includes('node_modules'));
            const gitFiles = files.filter(f => f.includes('.git'));
            const distFiles = files.filter(f => f.includes('dist'));
            
            expect(nodeModulesFiles).toHaveLength(0);
            expect(gitFiles).toHaveLength(0);
            expect(distFiles).toHaveLength(0);
        });

        it('should filter by file extensions correctly', async () => {
            const tsFiles = await discoverFiles(testDir, ['.ts'], []);
            const tsxFiles = await discoverFiles(testDir, ['.tsx'], []);
            const allFiles = await discoverFiles(testDir, ['.ts', '.tsx'], []);
            
            // All .ts files should be TypeScript files
            tsFiles.forEach(file => {
                expect(path.extname(file)).toBe('.ts');
            });
            
            // All .tsx files should be TSX files
            tsxFiles.forEach(file => {
                expect(path.extname(file)).toBe('.tsx');
            });
            
            // Combined should include both
            expect(allFiles.length).toBe(tsFiles.length + tsxFiles.length);
        });

        it('should return sorted file paths', async () => {
            const files = await discoverFiles(testDir, ['.ts', '.tsx'], []);
            const sortedFiles = [...files].sort();
            
            expect(files).toEqual(sortedFiles);
        });
    });

    describe('scanRepository', () => {
        it('should scan repository with given options', async () => {
            const options = {
                rootPath: testDir,
                extensions: ['.ts', '.tsx'],
                excludePatterns: ['**/*.test.ts']
            };
            
            const files = await scanRepository(options);
            
            expect(files.length).toBeGreaterThan(0);
            expect(files).toContain(path.join(testDir, 'src', 'index.ts'));
            expect(files).not.toContain(path.join(testDir, 'src', 'index.test.ts'));
        });

        it('should throw error for invalid root path', async () => {
            const options = {
                rootPath: '/nonexistent/path',
                extensions: ['.ts'],
                excludePatterns: []
            };
            
            await expect(scanRepository(options)).rejects.toThrow();
        });

        it('should throw error if root path is not a directory', async () => {
            const filePath = path.join(testDir, 'src', 'index.ts');
            const options = {
                rootPath: filePath,
                extensions: ['.ts'],
                excludePatterns: []
            };
            
            await expect(scanRepository(options)).rejects.toThrow('Root path is not a directory');
        });
    });

    describe('createDefaultScanOptions', () => {
        it('should create sensible defaults for TypeScript projects', () => {
            const options = createDefaultScanOptions('/path/to/repo');
            
            expect(options.rootPath).toBe('/path/to/repo');
            expect(options.extensions).toEqual(['.ts', '.tsx']);
            expect(options.excludePatterns).toContain('**/*.d.ts');
            expect(options.excludePatterns).toContain('**/dist/**');
            expect(options.excludePatterns).toContain('**/build/**');
            expect(options.excludePatterns.length).toBeGreaterThan(5); // Should have multiple exclusions
        });
    });
});

/**
 * Creates a test repository structure for testing
 */
async function createTestRepository(): Promise<void> {
    // Create directory structure
    await fs.promises.mkdir(testDir, { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'src', 'components'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'lib'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'node_modules'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'node_modules', 'package'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, '.git'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'dist'), { recursive: true });

    // Create test files
    const files = [
        { path: 'src/index.ts', content: 'export const main = () => console.log("Hello");' },
        { path: 'src/index.test.ts', content: 'import { main } from "./index"; test("main", () => {});' },
        { path: 'src/components/Button.tsx', content: 'export const Button = () => <button>Click</button>;' },
        { path: 'lib/utils.ts', content: 'export const helper = (x: number) => x * 2;' },
        { path: 'node_modules/package/index.ts', content: 'export const pkg = "package";' },
        { path: '.git/config', content: '[core]\n\trepositoryformatversion = 0' },
        { path: 'dist/index.js', content: 'console.log("compiled");' },
        { path: 'README.md', content: '# Test Repository' },
        { path: 'package.json', content: '{"name": "test-repo"}' }
    ];

    for (const file of files) {
        const filePath = path.join(testDir, file.path);
        await fs.promises.writeFile(filePath, file.content, 'utf8');
    }
}

/**
 * Cleans up the test repository
 */
async function cleanupTestRepository(): Promise<void> {
    try {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
        console.warn(`Failed to cleanup test directory: ${error}`);
    }
}