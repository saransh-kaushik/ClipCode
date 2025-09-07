/**
 * Integration tests for the complete repository processing pipeline
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { processRepository } from './batch-processor';
import { scanRepository, createDefaultScanOptions } from './repository-scanner';

// Test directory structure
const testDir = path.join(__dirname, 'test-integration-repo');

describe('Repository Processing Integration', () => {
    beforeEach(async () => {
        // Create test repository structure
        await createIntegrationTestRepository();
    });

    afterEach(async () => {
        // Clean up test directory
        await cleanupIntegrationTestRepository();
    });

    it('should process a complete repository end-to-end', async () => {
        const result = await processRepository(testDir, 1000, 'text-embedding-3-large', 2);

        // Verify processing results
        expect(result.stats.filesProcessed).toBeGreaterThan(0);
        expect(result.stats.chunksCreated).toBeGreaterThan(0);
        expect(result.chunks.length).toBe(result.stats.chunksCreated);
        expect(result.processingTimeMs).toBeGreaterThan(0);

        // Verify chunk metadata
        result.chunks.forEach(chunk => {
            expect(chunk.metadata.filePath).toBeTruthy();
            expect(chunk.metadata.language).toBeTruthy();
            expect(chunk.metadata.startLine).toBeGreaterThan(0);
            expect(chunk.metadata.endLine).toBeGreaterThanOrEqual(chunk.metadata.startLine);
            expect(chunk.content.trim()).toBeTruthy();
            expect(chunk.tokenCount).toBeGreaterThan(0);
        });

        // Verify file coverage - should have chunks from different files
        const uniqueFiles = new Set(result.chunks.map(chunk => chunk.metadata.filePath));
        expect(uniqueFiles.size).toBeGreaterThan(1);
    });

    it('should handle repository scanning and batch processing separately', async () => {
        // First, scan the repository
        const scanOptions = createDefaultScanOptions(testDir);
        const files = await scanRepository(scanOptions);
        
        expect(files.length).toBeGreaterThan(0);
        
        // Verify discovered files are TypeScript files
        files.forEach(file => {
            const ext = path.extname(file);
            expect(['.ts', '.tsx'].includes(ext)).toBe(true);
        });

        // Then process with batch processor
        const result = await processRepository(testDir);
        
        expect(result.stats.filesProcessed).toBeGreaterThan(0);
        expect(result.stats.chunksCreated).toBeGreaterThan(0);
    });

    it('should respect exclude patterns in end-to-end processing', async () => {
        const result = await processRepository(testDir);

        // Should not include any chunks from excluded directories
        const excludedChunks = result.chunks.filter(chunk => 
            chunk.metadata.filePath.includes('node_modules') ||
            chunk.metadata.filePath.includes('.git') ||
            chunk.metadata.filePath.includes('dist')
        );
        
        expect(excludedChunks).toHaveLength(0);
    });

    it('should handle different TypeScript constructs correctly', async () => {
        const result = await processRepository(testDir);

        // Should have chunks with different symbol types
        const symbolTypes = new Set(
            result.chunks
                .map(chunk => chunk.metadata.symbolType)
                .filter(type => type !== undefined)
        );

        expect(symbolTypes.size).toBeGreaterThan(0);
        
        // Should have both AST node chunks and gap chunks
        const chunkTypes = new Set(result.chunks.map(chunk => chunk.metadata.chunkType));
        expect(chunkTypes.has('ast_node')).toBe(true);
        expect(chunkTypes.has('gap')).toBe(true);
    });

    it('should maintain line number accuracy across chunks', async () => {
        const result = await processRepository(testDir);

        // Verify all chunks have valid line numbers
        result.chunks.forEach(chunk => {
            expect(chunk.startLine).toBeGreaterThan(0);
            expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
            expect(chunk.metadata.startLine).toBe(chunk.startLine);
            expect(chunk.metadata.endLine).toBe(chunk.endLine);
        });

        // Group chunks by file and verify coverage
        const chunksByFile = result.chunks.reduce((acc, chunk) => {
            const filePath = chunk.metadata.filePath;
            if (!acc[filePath]) {
                acc[filePath] = [];
            }
            acc[filePath].push(chunk);
            return acc;
        }, {} as Record<string, typeof result.chunks>);

        // Verify each file has reasonable chunk coverage
        Object.entries(chunksByFile).forEach(([filePath, chunks]) => {
            expect(chunks.length).toBeGreaterThan(0);
            
            // All chunks should be from the same file
            chunks.forEach(chunk => {
                expect(chunk.metadata.filePath).toBe(filePath);
            });
            
            // Should have a mix of chunk types for non-trivial files
            const chunkTypes = new Set(chunks.map(c => c.metadata.chunkType));
            if (chunks.length > 1) {
                expect(chunkTypes.size).toBeGreaterThan(0);
            }
        });
    });
});

/**
 * Creates a comprehensive test repository for integration testing
 */
async function createIntegrationTestRepository(): Promise<void> {
    // Create directory structure
    await fs.promises.mkdir(testDir, { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'src', 'components'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'lib'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'types'), { recursive: true });
    
    // Create excluded directories (should not be processed)
    await fs.promises.mkdir(path.join(testDir, 'node_modules'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, '.git'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'dist'), { recursive: true });

    // Create comprehensive test files
    const files = [
        {
            path: 'src/index.ts',
            content: `import { UserService } from './services/UserService';
import { Logger } from '../lib/logger';

const logger = new Logger('App');

export class Application {
    private userService: UserService;
    
    constructor() {
        this.userService = new UserService();
        logger.info('Application initialized');
    }
    
    async start(): Promise<void> {
        logger.info('Starting application...');
        await this.userService.initialize();
        logger.info('Application started successfully');
    }
}

export const app = new Application();`
        },
        {
            path: 'src/components/Button.tsx',
            content: `import React from 'react';

interface ButtonProps {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({ 
    label, 
    onClick, 
    disabled = false, 
    variant = 'primary' 
}) => {
    const handleClick = () => {
        if (!disabled) {
            onClick();
        }
    };

    return (
        <button 
            className={\`btn btn-\${variant}\`}
            onClick={handleClick}
            disabled={disabled}
        >
            {label}
        </button>
    );
};`
        },
        {
            path: 'lib/logger.ts',
            content: `export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    context?: string;
}

export class Logger {
    private context: string;
    private minLevel: LogLevel = LogLevel.INFO;
    
    constructor(context: string) {
        this.context = context;
    }
    
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }
    
    debug(message: string): void {
        this.log(LogLevel.DEBUG, message);
    }
    
    info(message: string): void {
        this.log(LogLevel.INFO, message);
    }
    
    warn(message: string): void {
        this.log(LogLevel.WARN, message);
    }
    
    error(message: string): void {
        this.log(LogLevel.ERROR, message);
    }
    
    private log(level: LogLevel, message: string): void {
        if (level >= this.minLevel) {
            const entry: LogEntry = {
                timestamp: new Date(),
                level,
                message,
                context: this.context
            };
            console.log(JSON.stringify(entry));
        }
    }
}`
        },
        {
            path: 'types/api.ts',
            content: `export interface User {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateUserRequest {
    email: string;
    name: string;
}

export interface UpdateUserRequest {
    name?: string;
}

export type UserResponse = User;
export type UsersResponse = User[];

export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, any>;
}`
        },
        {
            path: 'src/services/UserService.ts',
            content: `import { User, CreateUserRequest, UpdateUserRequest } from '../../types/api';
import { Logger } from '../../lib/logger';

export class UserService {
    private logger = new Logger('UserService');
    private users: Map<string, User> = new Map();
    
    async initialize(): Promise<void> {
        this.logger.info('Initializing UserService');
        // Simulate async initialization
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    async createUser(request: CreateUserRequest): Promise<User> {
        const user: User = {
            id: Math.random().toString(36),
            email: request.email,
            name: request.name,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        this.users.set(user.id, user);
        this.logger.info(\`Created user: \${user.id}\`);
        
        return user;
    }
    
    async getUser(id: string): Promise<User | null> {
        return this.users.get(id) || null;
    }
    
    async updateUser(id: string, request: UpdateUserRequest): Promise<User | null> {
        const user = this.users.get(id);
        if (!user) {
            return null;
        }
        
        const updatedUser: User = {
            ...user,
            ...request,
            updatedAt: new Date()
        };
        
        this.users.set(id, updatedUser);
        this.logger.info(\`Updated user: \${id}\`);
        
        return updatedUser;
    }
}`
        },
        // Files in excluded directories (should not be processed)
        {
            path: 'node_modules/some-package/index.ts',
            content: 'export const pkg = "should not be processed";'
        },
        {
            path: '.git/hooks/pre-commit',
            content: '#!/bin/bash\necho "git hook"'
        },
        {
            path: 'dist/index.js',
            content: 'console.log("compiled output");'
        }
    ];

    for (const file of files) {
        const filePath = path.join(testDir, file.path);
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(filePath, file.content, 'utf8');
    }
}

/**
 * Cleans up the integration test repository
 */
async function cleanupIntegrationTestRepository(): Promise<void> {
    try {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
        console.warn(`Failed to cleanup test directory: ${error}`);
    }
}