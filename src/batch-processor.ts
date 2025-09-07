/**
 * Batch processing functionality for handling multiple files with concurrency control
 */

import { chunkFile } from './chunk-file';
import { scanRepository, createDefaultScanOptions } from './repository-scanner';
import { 
    ProcessingStats, 
    ProcessingError, 
    FileChunk, 
    ChunkFileOptions, 
    ScanOptions,
    ErrorType 
} from './types';

/**
 * Configuration options for batch processing
 */
export interface BatchProcessingOptions {
    rootPath: string;
    maxTokens: number;
    modelName: string;
    concurrency?: number;
    extensions?: string[];
    excludePatterns?: string[];
    continueOnError?: boolean;
}

/**
 * Result of batch processing operation
 */
export interface BatchProcessingResult {
    stats: ProcessingStats;
    chunks: FileChunk[];
    processingTimeMs: number;
}

/**
 * Individual file processing result
 */
interface FileProcessingResult {
    filePath: string;
    chunks: FileChunk[];
    error?: ProcessingError;
    processingTimeMs: number;
}

/**
 * Processes multiple files in parallel with concurrency limits.
 * Handles errors gracefully and continues processing remaining files.
 * 
 * @param options - Batch processing configuration
 * @returns Promise resolving to batch processing results
 */
export async function batchProcessFiles(options: BatchProcessingOptions): Promise<BatchProcessingResult> {
    const startTime = Date.now();
    
    const {
        rootPath,
        maxTokens,
        modelName,
        concurrency = 4, // Default concurrency limit
        extensions = ['.ts', '.tsx'],
        excludePatterns = [],
        continueOnError = true
    } = options;

    // Discover files to process
    const scanOptions: ScanOptions = {
        rootPath,
        extensions,
        excludePatterns
    };

    let filePaths: string[];
    try {
        filePaths = await scanRepository(scanOptions);
    } catch (error) {
        throw new Error(`Failed to scan repository: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (filePaths.length === 0) {
        return {
            stats: {
                filesProcessed: 0,
                chunksCreated: 0,
                errors: []
            },
            chunks: [],
            processingTimeMs: Date.now() - startTime
        };
    }

    // Process files with concurrency control
    const results = await processFilesWithConcurrency(
        filePaths,
        { maxTokens, modelName },
        concurrency,
        continueOnError
    );

    // Aggregate results
    const allChunks: FileChunk[] = [];
    const errors: ProcessingError[] = [];
    let filesProcessed = 0;

    for (const result of results) {
        if (result.error) {
            errors.push(result.error);
        } else {
            filesProcessed++;
            allChunks.push(...result.chunks);
        }
    }

    const processingTimeMs = Date.now() - startTime;

    return {
        stats: {
            filesProcessed,
            chunksCreated: allChunks.length,
            errors
        },
        chunks: allChunks,
        processingTimeMs
    };
}

/**
 * Processes files with controlled concurrency using a semaphore-like approach.
 * 
 * @param filePaths - Array of file paths to process
 * @param chunkOptions - Options for chunking individual files
 * @param concurrency - Maximum number of concurrent operations
 * @param continueOnError - Whether to continue processing on individual file errors
 * @returns Promise resolving to array of file processing results
 */
async function processFilesWithConcurrency(
    filePaths: string[],
    chunkOptions: Omit<ChunkFileOptions, 'filePath'>,
    concurrency: number,
    continueOnError: boolean
): Promise<FileProcessingResult[]> {
    const results: FileProcessingResult[] = [];
    const inProgress: Promise<FileProcessingResult>[] = [];

    for (const filePath of filePaths) {
        // Wait if we've reached the concurrency limit
        if (inProgress.length >= concurrency) {
            const completed = await Promise.race(inProgress);
            results.push(completed);
            
            // Remove completed promise from in-progress array
            const index = inProgress.findIndex(p => p === Promise.resolve(completed));
            if (index > -1) {
                inProgress.splice(index, 1);
            }
        }

        // Start processing the next file
        const processingPromise = processFileWithErrorHandling(
            filePath,
            { ...chunkOptions, filePath },
            continueOnError
        );
        
        inProgress.push(processingPromise);
    }

    // Wait for all remaining files to complete
    const remainingResults = await Promise.all(inProgress);
    results.push(...remainingResults);

    return results;
}

/**
 * Processes a single file with comprehensive error handling.
 * 
 * @param filePath - Path to the file to process
 * @param options - Chunking options for the file
 * @param continueOnError - Whether to return error info instead of throwing
 * @returns Promise resolving to file processing result
 */
async function processFileWithErrorHandling(
    filePath: string,
    options: ChunkFileOptions,
    continueOnError: boolean
): Promise<FileProcessingResult> {
    const startTime = Date.now();

    try {
        const chunks = chunkFile(options);
        
        return {
            filePath,
            chunks,
            processingTimeMs: Date.now() - startTime
        };
    } catch (error) {
        const processingError: ProcessingError = {
            type: determineErrorType(error),
            filePath,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            recoverable: continueOnError,
            timestamp: new Date()
        };

        if (!continueOnError) {
            throw error;
        }

        return {
            filePath,
            chunks: [],
            error: processingError,
            processingTimeMs: Date.now() - startTime
        };
    }
}

/**
 * Determines the error type based on the error instance.
 * 
 * @param error - The error to categorize
 * @returns ErrorType classification
 */
function determineErrorType(error: unknown): ErrorType {
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('enoent') || message.includes('eacces') || message.includes('file')) {
            return 'file_system';
        }
        
        if (message.includes('parse') || message.includes('syntax')) {
            return 'parsing';
        }
        
        if (message.includes('token') || message.includes('tiktoken')) {
            return 'token_processing';
        }
        
        if (message.includes('chroma') || message.includes('database') || message.includes('embedding')) {
            return 'database';
        }
    }
    
    return 'parsing'; // Default fallback
}

/**
 * Convenience function for processing a repository with default settings.
 * 
 * @param rootPath - Repository root path
 * @param maxTokens - Maximum tokens per chunk
 * @param modelName - Tokenizer model name
 * @param concurrency - Optional concurrency limit (default: 4)
 * @returns Promise resolving to batch processing results
 */
export async function processRepository(
    rootPath: string,
    maxTokens: number = 1000,
    modelName: string = 'text-embedding-3-large',
    concurrency: number = 4
): Promise<BatchProcessingResult> {
    const defaultOptions = createDefaultScanOptions(rootPath);
    
    const batchOptions: BatchProcessingOptions = {
        rootPath,
        maxTokens,
        modelName,
        concurrency,
        extensions: defaultOptions.extensions,
        excludePatterns: defaultOptions.excludePatterns,
        continueOnError: true
    };

    return batchProcessFiles(batchOptions);
}

/**
 * Prints processing statistics in a human-readable format.
 * 
 * @param result - Batch processing result to display
 */
export function printProcessingStats(result: BatchProcessingResult): void {
    const { stats, processingTimeMs } = result;
    
    console.log('\n=== Processing Statistics ===');
    console.log(`Files processed: ${stats.filesProcessed}`);
    console.log(`Chunks created: ${stats.chunksCreated}`);
    console.log(`Processing time: ${(processingTimeMs / 1000).toFixed(2)}s`);
    
    if (stats.chunksCreated > 0) {
        console.log(`Average chunks per file: ${(stats.chunksCreated / stats.filesProcessed).toFixed(1)}`);
        console.log(`Processing rate: ${(stats.filesProcessed / (processingTimeMs / 1000)).toFixed(1)} files/sec`);
    }
    
    if (stats.errors.length > 0) {
        console.log(`\nErrors encountered: ${stats.errors.length}`);
        
        // Group errors by type
        const errorsByType = stats.errors.reduce((acc, error) => {
            acc[error.type] = (acc[error.type] || 0) + 1;
            return acc;
        }, {} as Record<ErrorType, number>);
        
        Object.entries(errorsByType).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        
        // Show first few errors for debugging
        console.log('\nFirst few errors:');
        stats.errors.slice(0, 3).forEach((error, index) => {
            console.log(`  ${index + 1}. ${error.filePath}: ${error.message}`);
        });
        
        if (stats.errors.length > 3) {
            console.log(`  ... and ${stats.errors.length - 3} more`);
        }
    }
    
    console.log('=============================\n');
}

/**
 * Validates batch processing options and provides helpful error messages.
 * 
 * @param options - Options to validate
 * @throws Error if options are invalid
 */
export function validateBatchOptions(options: BatchProcessingOptions): void {
    if (!options.rootPath) {
        throw new Error('rootPath is required');
    }
    
    if (!options.maxTokens || options.maxTokens <= 0) {
        throw new Error('maxTokens must be a positive number');
    }
    
    if (!options.modelName) {
        throw new Error('modelName is required');
    }
    
    if (options.concurrency !== undefined && options.concurrency <= 0) {
        throw new Error('concurrency must be a positive number');
    }
    
    if (options.extensions && options.extensions.length === 0) {
        throw new Error('extensions array cannot be empty');
    }
}