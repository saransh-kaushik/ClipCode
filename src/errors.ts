/**
 * Error handling types and utilities for the code chunking system
 */

import { ErrorType, ProcessingError } from './types';



/**
 * Custom error classes for different error categories
 */
export class ChunkingError extends Error {
    public readonly type: ErrorType;
    public readonly filePath?: string;
    public readonly recoverable: boolean;
    public readonly timestamp: Date;

    constructor(
        type: ErrorType,
        message: string,
        filePath?: string,
        recoverable: boolean = true
    ) {
        super(message);
        this.name = 'ChunkingError';
        this.type = type;
        this.filePath = filePath;
        this.recoverable = recoverable;
        this.timestamp = new Date();
    }

    toProcessingError(): ProcessingError {
        return {
            type: this.type,
            filePath: this.filePath,
            message: this.message,
            stack: this.stack,
            recoverable: this.recoverable,
            timestamp: this.timestamp
        };
    }
}

/**
 * File system related errors
 */
export class FileSystemError extends ChunkingError {
    constructor(message: string, filePath?: string, recoverable: boolean = true) {
        super('file_system', message, filePath, recoverable);
        this.name = 'FileSystemError';
    }
}

/**
 * Parsing related errors
 */
export class ParsingError extends ChunkingError {
    constructor(message: string, filePath?: string, recoverable: boolean = true) {
        super('parsing', message, filePath, recoverable);
        this.name = 'ParsingError';
    }
}

/**
 * Token processing related errors
 */
export class TokenProcessingError extends ChunkingError {
    constructor(message: string, filePath?: string, recoverable: boolean = true) {
        super('token_processing', message, filePath, recoverable);
        this.name = 'TokenProcessingError';
    }
}

/**
 * Database related errors
 */
export class DatabaseError extends ChunkingError {
    constructor(message: string, filePath?: string, recoverable: boolean = true) {
        super('database', message, filePath, recoverable);
        this.name = 'DatabaseError';
    }
}

/**
 * Error handling utilities
 */
export class ErrorHandler {
    private errors: ProcessingError[] = [];

    /**
     * Add an error to the collection
     */
    addError(error: ProcessingError | ChunkingError | Error, filePath?: string): void {
        if (error instanceof ChunkingError) {
            this.errors.push(error.toProcessingError());
        } else if (error instanceof Error) {
            this.errors.push({
                type: 'file_system',
                filePath,
                message: error.message,
                stack: error.stack,
                recoverable: true,
                timestamp: new Date()
            });
        } else {
            this.errors.push(error);
        }
    }

    /**
     * Get all collected errors
     */
    getErrors(): ProcessingError[] {
        return [...this.errors];
    }

    /**
     * Get errors by type
     */
    getErrorsByType(type: ErrorType): ProcessingError[] {
        return this.errors.filter(error => error.type === type);
    }

    /**
     * Get recoverable errors
     */
    getRecoverableErrors(): ProcessingError[] {
        return this.errors.filter(error => error.recoverable);
    }

    /**
     * Get non-recoverable errors
     */
    getNonRecoverableErrors(): ProcessingError[] {
        return this.errors.filter(error => !error.recoverable);
    }

    /**
     * Check if there are any non-recoverable errors
     */
    hasNonRecoverableErrors(): boolean {
        return this.getNonRecoverableErrors().length > 0;
    }

    /**
     * Clear all errors
     */
    clear(): void {
        this.errors = [];
    }

    /**
     * Get error summary
     */
    getSummary(): {
        total: number;
        byType: Record<ErrorType, number>;
        recoverable: number;
        nonRecoverable: number;
    } {
        const byType: Record<ErrorType, number> = {
            file_system: 0,
            parsing: 0,
            token_processing: 0,
            database: 0
        };

        this.errors.forEach(error => {
            byType[error.type]++;
        });

        return {
            total: this.errors.length,
            byType,
            recoverable: this.getRecoverableErrors().length,
            nonRecoverable: this.getNonRecoverableErrors().length
        };
    }
}

/**
 * Utility function to safely execute operations with error handling
 */
export async function safeExecute<T>(
    operation: () => Promise<T> | T,
    errorHandler: ErrorHandler,
    filePath?: string,
    errorType: ErrorType = 'file_system'
): Promise<T | null> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof ChunkingError) {
            errorHandler.addError(error);
        } else if (error instanceof Error) {
            errorHandler.addError(new ChunkingError(errorType, error.message, filePath));
        } else {
            errorHandler.addError(new ChunkingError(errorType, String(error), filePath));
        }
        return null;
    }
}

/**
 * Utility function to create error with context
 */
export function createError(
    type: ErrorType,
    message: string,
    filePath?: string,
    recoverable: boolean = true
): ChunkingError {
    switch (type) {
        case 'file_system':
            return new FileSystemError(message, filePath, recoverable);
        case 'parsing':
            return new ParsingError(message, filePath, recoverable);
        case 'token_processing':
            return new TokenProcessingError(message, filePath, recoverable);
        case 'database':
            return new DatabaseError(message, filePath, recoverable);
        default:
            return new ChunkingError(type, message, filePath, recoverable);
    }
}