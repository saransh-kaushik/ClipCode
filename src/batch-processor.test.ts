/**
 * Tests for batch processing functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { 
    batchProcessFiles, 
    processRepository, 
    printProcessingStats, 
    validateBatchOptions,
    BatchProcessingOptions 
} from './batch-processor';

// Mock the chunkFile function to avoid actual file processing in tests
vi.mock('./chunk-file', () => ({
    chunkFile: vi.fn((options) => {
        // Simulate different behaviors based on file path
        if (options.filePath.includes('error')) {
            throw new Error('Simulated processing error');
        }
        
        if (options.filePath.includes('empty')) {
            return [];
        }
        
        // Return mock chunks for successful processing
        return [
            {
                content: 'mock content',
                metadata: {
                    filePath: options.filePath,
                    language: 'typescript',
                    chunkType: 'ast_node',
                    startLine: 1,
                    endLine: 10
                },
                startLine: 1,
                endLine: 10,
                tokenCount: 50
            }
        ];
    })
}));

// Test directory structure
const testDir = path.join(__dirname, 'test-batch-repo');

describe('Batch Processor', () => {
    beforeEach(async () => {
        // Create test repository structure
        await createTestBatchRepository();
    });

    afterEach(async () => {
        // Clean up test directory
        await cleanupTestBatchRepository();
    });

    describe('batchProcessFiles', () => {
        it('should process multiple files successfully', async () => {
            const options: BatchProcessingOptions = {
                rootPath: testDir,
                maxTokens: 1000,
                modelName: 'text-embedding-3-large',
                concurrency: 2,
                extensions: ['.ts'],
                excludePatterns: [],
                continueOnError: true
            };

            const result = await batchProcessFiles(options);

            expect(result.stats.filesProcessed).toBeGreaterThan(0);
            expect(result.stats.chunksCreated).toBeGreaterThan(0);
            expect(result.chunks.length).toBe(result.stats.chunksCreated);
            expect(result.processingTimeMs).toBeGreaterThan(0);
        });

        it('should handle errors gracefully when continueOnError is true', async () => {
            const options: BatchProcessingOptions = {
                rootPath: testDir,
                maxTokens: 1000,
                modelName: 'text-embedding-3-large',
                concurrency: 2,
                extensions: ['.ts'],
                excludePatterns: [],
                continueOnError: true
            };

            const result = await batchProcessFiles(options);

            // Should have some errors from files with 'error' in the name
            expect(result.stats.errors.length).toBeGreaterThan(0);
            
            // Should still process other files successfully
            expect(result.stats.filesProcessed).toBeGreaterThan(0);
        });

        it('should respect concurrency limits', async () => {
            const options: BatchProcessingOptions = {
                rootPath: testDir,
                maxTokens: 1000,
                modelName: 'text-embedding-3-large',
                concurrency: 1, // Very low concurrency for testing
                extensions: ['.ts'],
                excludePatterns: [],
                continueOnError: true
            };

            const startTime = Date.now();
            const result = await batchProcessFiles(options);
            const endTime = Date.now();

            // With concurrency of 1, processing should take longer
            expect(result.processingTimeMs).toBeGreaterThan(0);
            expect(endTime - startTime).toBeGreaterThanOrEqual(result.processingTimeMs);
        });

        it('should handle empty repository', async () => {
            const emptyDir = path.join(testDir, 'empty');
            await fs.promises.mkdir(emptyDir, { recursive: true });

            const options: BatchProcessingOptions = {
                rootPath: emptyDir,
                maxTokens: 1000,
                modelName: 'text-embedding-3-large',
                extensions: ['.ts'],
                excludePatterns: []
            };

            const result = await batchProcessFiles(options);

            expect(result.stats.filesProcessed).toBe(0);
            expect(result.stats.chunksCreated).toBe(0);
            expect(result.chunks).toHaveLength(0);
            expect(result.stats.errors).toHaveLength(0);
        });

        it('should filter files by extensions', async () => {
            const options: BatchProcessingOptions = {
                rootPath: testDir,
                maxTokens: 1000,
                modelName: 'text-embedding-3-large',
                extensions: ['.tsx'], // Only TSX files
                excludePatterns: [],
                continueOnError: true
            };

            const result = await batchProcessFiles(options);

            // Should only process .tsx files
            result.chunks.forEach(chunk => {
                expect(chunk.metadata.filePath.endsWith('.tsx')).toBe(true);
            });
        });

        it('should exclude files based on patterns', async () => {
            const options: BatchProcessingOptions = {
                rootPath: testDir,
                maxTokens: 1000,
                modelName: 'text-embedding-3-large',
                extensions: ['.ts', '.tsx'],
                excludePatterns: ['**/*error*'], // Exclude files with 'error' in name
                continueOnError: true
            };

            const result = await batchProcessFiles(options);

            // Should have fewer errors since error files are excluded
            const errorFiles = result.chunks.filter(chunk => 
                chunk.metadata.filePath.includes('error')
            );
            expect(errorFiles).toHaveLength(0);
        });
    });

    describe('processRepository', () => {
        it('should process repository with default settings', async () => {
            const result = await processRepository(testDir);

            expect(result.stats.filesProcessed).toBeGreaterThan(0);
            expect(result.stats.chunksCreated).toBeGreaterThan(0);
            expect(result.processingTimeMs).toBeGreaterThan(0);
        });

        it('should use custom parameters', async () => {
            const result = await processRepository(testDir, 500, 'gpt-4', 1);

            expect(result.stats.filesProcessed).toBeGreaterThan(0);
            // Should still work with different parameters
        });
    });

    describe('validateBatchOptions', () => {
        it('should validate required options', () => {
            expect(() => validateBatchOptions({} as BatchProcessingOptions)).toThrow('rootPath is required');
            
            expect(() => validateBatchOptions({
                rootPath: '/path',
                maxTokens: 0,
                modelName: 'model'
            })).toThrow('maxTokens must be a positive number');
            
            expect(() => validateBatchOptions({
                rootPath: '/path',
                maxTokens: 1000,
                modelName: ''
            })).toThrow('modelName is required');
        });

        it('should validate optional parameters', () => {
            expect(() => validateBatchOptions({
                rootPath: '/path',
                maxTokens: 1000,
                modelName: 'model',
                concurrency: 0
            })).toThrow('concurrency must be a positive number');
            
            expect(() => validateBatchOptions({
                rootPath: '/path',
                maxTokens: 1000,
                modelName: 'model',
                extensions: []
            })).toThrow('extensions array cannot be empty');
        });

        it('should pass validation for valid options', () => {
            expect(() => validateBatchOptions({
                rootPath: '/path',
                maxTokens: 1000,
                modelName: 'model'
            })).not.toThrow();
        });
    });

    describe('printProcessingStats', () => {
        it('should print stats without errors', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            
            const result = {
                stats: {
                    filesProcessed: 5,
                    chunksCreated: 25,
                    errors: []
                },
                chunks: [],
                processingTimeMs: 1500
            };

            printProcessingStats(result);

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Files processed: 5'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Chunks created: 25'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Processing time: 1.50s'));
            
            consoleSpy.mockRestore();
        });

        it('should print stats with errors', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            
            const result = {
                stats: {
                    filesProcessed: 3,
                    chunksCreated: 15,
                    errors: [
                        {
                            type: 'file_system' as const,
                            filePath: '/test/file1.ts',
                            message: 'File not found',
                            recoverable: true,
                            timestamp: new Date()
                        },
                        {
                            type: 'parsing' as const,
                            filePath: '/test/file2.ts',
                            message: 'Syntax error',
                            recoverable: true,
                            timestamp: new Date()
                        }
                    ]
                },
                chunks: [],
                processingTimeMs: 2000
            };

            printProcessingStats(result);

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Errors encountered: 2'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('file_system: 1'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('parsing: 1'));
            
            consoleSpy.mockRestore();
        });
    });
});

/**
 * Creates a test repository structure for batch processing tests
 */
async function createTestBatchRepository(): Promise<void> {
    // Create directory structure
    await fs.promises.mkdir(testDir, { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'lib'), { recursive: true });

    // Create test files with different characteristics
    const files = [
        { path: 'src/index.ts', content: 'export const main = () => console.log("Hello");' },
        { path: 'src/utils.ts', content: 'export const helper = (x: number) => x * 2;' },
        { path: 'src/component.tsx', content: 'export const Button = () => <button>Click</button>;' },
        { path: 'lib/error-file.ts', content: 'export const broken = () => {' }, // This will cause parsing errors
        { path: 'lib/empty-file.ts', content: '' }, // Empty file
        { path: 'src/large-file.ts', content: 'export const data = ' + JSON.stringify(Array(100).fill('test')) + ';' }
    ];

    for (const file of files) {
        const filePath = path.join(testDir, file.path);
        await fs.promises.writeFile(filePath, file.content, 'utf8');
    }
}

/**
 * Cleans up the test repository
 */
async function cleanupTestBatchRepository(): Promise<void> {
    try {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
        console.warn(`Failed to cleanup test directory: ${error}`);
    }
}