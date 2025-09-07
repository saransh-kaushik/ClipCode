/**
 * Tests for the chunkFile function
 */

import { describe, it, expect } from 'vitest';
import { chunkFile } from './chunk-file';
import fs from 'fs';
import path from 'path';

describe('chunkFile', () => {
    it('should process a TypeScript file and return chunks with metadata', () => {
        // Create a test TypeScript file
        const testFilePath = 'test-sample.ts';
        const testContent = `import { Component } from 'react';

export interface User {
    id: number;
    name: string;
}

export class UserService {
    private users: User[] = [];
    
    addUser(user: User): void {
        this.users.push(user);
    }
    
    getUser(id: number): User | undefined {
        return this.users.find(u => u.id === id);
    }
}

const DEFAULT_CONFIG = {
    timeout: 5000,
    retries: 3
};

export default UserService;`;

        // Write test file
        fs.writeFileSync(testFilePath, testContent);

        try {
            // Process the file
            const chunks = chunkFile({
                filePath: testFilePath,
                maxTokens: 100,
                modelName: 'text-embedding-3-large'
            });

            // Verify we got chunks
            expect(chunks.length).toBeGreaterThan(0);

            // Verify all chunks have required metadata
            for (const chunk of chunks) {
                expect(chunk.content).toBeDefined();
                expect(chunk.metadata).toBeDefined();
                expect(chunk.metadata.filePath).toBe(testFilePath);
                expect(chunk.metadata.language).toBe('typescript');
                expect(chunk.metadata.chunkType).toMatch(/^(ast_node|gap|split)$/);
                expect(chunk.startLine).toBeGreaterThan(0);
                expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
                expect(chunk.tokenCount).toBeGreaterThan(0);
            }

            // Verify we have both AST nodes and gaps
            const astNodeChunks = chunks.filter(c => c.metadata.chunkType === 'ast_node');
            const gapChunks = chunks.filter(c => c.metadata.chunkType === 'gap');
            
            expect(astNodeChunks.length).toBeGreaterThan(0);
            expect(gapChunks.length).toBeGreaterThan(0);

            // Verify some chunks have symbol information
            const symbolChunks = chunks.filter(c => c.metadata.symbolName);
            expect(symbolChunks.length).toBeGreaterThan(0);

            // Verify chunks are sorted by line number
            for (let i = 1; i < chunks.length; i++) {
                expect(chunks[i].startLine).toBeGreaterThanOrEqual(chunks[i - 1].startLine);
            }

            console.log(`Processed ${testFilePath} into ${chunks.length} chunks:`);
            chunks.forEach((chunk, i) => {
                console.log(`  ${i + 1}. Lines ${chunk.startLine}-${chunk.endLine}: ${chunk.metadata.chunkType}${chunk.metadata.symbolName ? ` (${chunk.metadata.symbolName})` : ''}`);
            });

        } finally {
            // Clean up test file
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });

    it('should return empty array for unsupported file types', () => {
        const testFilePath = 'test-sample.py';
        const testContent = 'print("Hello, World!")';

        fs.writeFileSync(testFilePath, testContent);

        try {
            const chunks = chunkFile({
                filePath: testFilePath,
                maxTokens: 100,
                modelName: 'text-embedding-3-large'
            });

            expect(chunks).toEqual([]);
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });

    it('should handle empty files gracefully', () => {
        const testFilePath = 'test-empty.ts';
        fs.writeFileSync(testFilePath, '');

        try {
            const chunks = chunkFile({
                filePath: testFilePath,
                maxTokens: 100,
                modelName: 'text-embedding-3-large'
            });

            expect(chunks).toEqual([]);
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });
});