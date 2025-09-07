/**
 * Comprehensive tests for token-aware code splitting functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { splitCode, flushChunk, validateSplits } from './split';
import { createTokenizer } from './tokenizer';
import { CodeSplit, SplitOptions } from './types';

describe('splitCode', () => {
    let tokenizer: any;
    
    beforeEach(() => {
        tokenizer = createTokenizer('text-embedding-3-large');
    });
    
    describe('basic splitting functionality', () => {
        it('should split code that exceeds token limits', () => {
            const sourceCode = `function hello() {
    console.log("Hello, world!");
}

function goodbye() {
    console.log("Goodbye, world!");
}

const message = "This is a test message";
console.log(message);`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 20, // Small limit to force splitting
                tokenizer
            };
            
            const splits = splitCode(options);
            
            expect(splits.length).toBeGreaterThan(1);
            
            // Verify each split respects token limits
            splits.forEach(split => {
                expect(split.tokenCount).toBeLessThanOrEqual(20);
                expect(split.startLine).toBeLessThanOrEqual(split.endLine);
                expect(split.content.trim().length).toBeGreaterThan(0);
            });
        });
        
        it('should handle code that fits within token limits', () => {
            const sourceCode = `const x = 1;
const y = 2;`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 100, // Large limit
                tokenizer
            };
            
            const splits = splitCode(options);
            
            expect(splits).toHaveLength(1);
            expect(splits[0].content).toBe(sourceCode);
            expect(splits[0].startLine).toBe(1);
            expect(splits[0].endLine).toBe(2);
        });
        
        it('should track line numbers correctly', () => {
            const sourceCode = `line 1
line 2
line 3
line 4`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 10, // Start from line 10
                maxTokens: 5, // Force splitting
                tokenizer
            };
            
            const splits = splitCode(options);
            
            // Verify line number continuity
            let expectedStartLine = 10;
            splits.forEach(split => {
                expect(split.startLine).toBe(expectedStartLine);
                expectedStartLine = split.endLine + 1;
            });
            
            // Verify last split ends at correct line
            const lastSplit = splits[splits.length - 1];
            expect(lastSplit.endLine).toBe(13); // 10 + 4 lines - 1
        });
    });
    
    describe('edge cases', () => {
        it('should handle empty source code', () => {
            const options: SplitOptions = {
                sourceCode: '',
                startLine: 1,
                maxTokens: 100,
                tokenizer
            };
            
            const splits = splitCode(options);
            expect(splits).toHaveLength(0);
        });
        
        it('should handle whitespace-only source code', () => {
            const options: SplitOptions = {
                sourceCode: '   \n\n   \n',
                startLine: 1,
                maxTokens: 100,
                tokenizer
            };
            
            const splits = splitCode(options);
            expect(splits).toHaveLength(0);
        });
        
        it('should handle empty lines within code', () => {
            const sourceCode = `function test() {

    console.log("test");

}`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 100,
                tokenizer
            };
            
            const splits = splitCode(options);
            
            expect(splits).toHaveLength(1);
            expect(splits[0].content).toBe(sourceCode);
            expect(splits[0].startLine).toBe(1);
            expect(splits[0].endLine).toBe(5);
        });
        
        it('should handle very long single lines', () => {
            // Create a very long line that exceeds token limits
            const longLine = 'const veryLongVariableName = ' + '"' + 'a'.repeat(1000) + '";';
            
            const options: SplitOptions = {
                sourceCode: longLine,
                startLine: 1,
                maxTokens: 50,
                tokenizer
            };
            
            const splits = splitCode(options);
            
            expect(splits.length).toBeGreaterThan(1);
            
            // All splits should be from the same line
            splits.forEach(split => {
                expect(split.startLine).toBe(1);
                expect(split.endLine).toBe(1);
                expect(split.tokenCount).toBeLessThanOrEqual(50);
            });
            
            // Concatenated content should equal original line
            const reconstructed = splits.map(s => s.content).join('');
            expect(reconstructed).toBe(longLine);
        });
        
        it('should handle single character when nothing else fits', () => {
            // Create content where even single tokens exceed limit (edge case)
            const sourceCode = 'x';
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 1,
                tokenizer
            };
            
            const splits = splitCode(options);
            
            expect(splits).toHaveLength(1);
            expect(splits[0].content).toBe('x');
        });
        
        it('should throw error for invalid maxTokens', () => {
            const options: SplitOptions = {
                sourceCode: 'test',
                startLine: 1,
                maxTokens: 0,
                tokenizer
            };
            
            expect(() => splitCode(options)).toThrow('maxTokens must be greater than 0');
        });
    });
    
    describe('line boundary preservation', () => {
        it('should never split within a line for normal cases', () => {
            const sourceCode = `function test() {
    const message = "Hello world";
    console.log(message);
    return message.length;
}`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 15, // Force multiple splits
                tokenizer
            };
            
            const splits = splitCode(options);
            
            // Verify each split contains complete lines
            splits.forEach(split => {
                const lines = split.content.split('\n');
                // Each line should be complete (no partial lines except for long line edge case)
                lines.forEach(line => {
                    // This is a heuristic - complete lines typically don't end mid-word
                    // unless they're part of a long line split
                    if (split.startLine === split.endLine && splits.length > 1) {
                        // This might be a long line split, which is acceptable
                        return;
                    }
                    expect(line).not.toMatch(/\w$/); // Should not end mid-word for multi-line splits
                });
            });
        });
        
        it('should maintain proper line endings', () => {
            const sourceCode = `line1\nline2\nline3`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 5, // Force splitting
                tokenizer
            };
            
            const splits = splitCode(options);
            
            // Verify line structure is preserved
            splits.forEach(split => {
                const lines = split.content.split('\n');
                const expectedLines = split.endLine - split.startLine + 1;
                expect(lines.length).toBe(expectedLines);
            });
        });
    });
    
    describe('token counting accuracy', () => {
        it('should accurately count tokens for each split', () => {
            const sourceCode = `function calculateSum(a, b) {
    return a + b;
}`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 100,
                tokenizer
            };
            
            const splits = splitCode(options);
            
            splits.forEach(split => {
                const actualTokens = tokenizer.countTokens(split.content);
                expect(split.tokenCount).toBe(actualTokens);
            });
        });
        
        it('should handle token counting for empty lines correctly', () => {
            const sourceCode = `function test() {

    console.log("test");
}`;
            
            const options: SplitOptions = {
                sourceCode,
                startLine: 1,
                maxTokens: 100,
                tokenizer
            };
            
            const splits = splitCode(options);
            
            expect(splits).toHaveLength(1);
            const actualTokens = tokenizer.countTokens(splits[0].content);
            expect(splits[0].tokenCount).toBe(actualTokens);
        });
    });
});

describe('flushChunk', () => {
    it('should create a chunk with correct properties', () => {
        const chunks: CodeSplit[] = [];
        const lines = ['line 1', 'line 2', 'line 3'];
        
        flushChunk(chunks, lines, 5, 7, 15);
        
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual({
            content: 'line 1\nline 2\nline 3',
            startLine: 5,
            endLine: 7,
            tokenCount: 15
        });
    });
    
    it('should ignore empty chunks', () => {
        const chunks: CodeSplit[] = [];
        const lines: string[] = [];
        
        flushChunk(chunks, lines, 1, 1, 0);
        
        expect(chunks).toHaveLength(0);
    });
    
    it('should ignore blank-only chunks', () => {
        const chunks: CodeSplit[] = [];
        const lines = ['   ', '\t', ''];
        
        flushChunk(chunks, lines, 1, 3, 0);
        
        expect(chunks).toHaveLength(0);
    });
});

describe('validateSplits', () => {
    it('should validate correct splits', () => {
        const splits: CodeSplit[] = [
            {
                content: 'line 1\nline 2',
                startLine: 1,
                endLine: 2,
                tokenCount: 5
            },
            {
                content: 'line 3\nline 4',
                startLine: 3,
                endLine: 4,
                tokenCount: 5
            }
        ];
        
        const result = validateSplits(splits, 1, 4);
        
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.totalLines).toBe(4);
        expect(result.coveredLines).toBe(4);
    });
    
    it('should detect invalid line numbers', () => {
        const splits: CodeSplit[] = [
            {
                content: 'test',
                startLine: 5,
                endLine: 3, // Invalid: start > end
                tokenCount: 2
            }
        ];
        
        const result = validateSplits(splits, 1, 5);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Split 0: startLine (5) > endLine (3)');
    });
    
    it('should detect content/line count mismatches', () => {
        const splits: CodeSplit[] = [
            {
                content: 'line 1\nline 2\nline 3', // 3 lines
                startLine: 1,
                endLine: 2, // But range indicates 2 lines
                tokenCount: 5
            }
        ];
        
        const result = validateSplits(splits, 1, 2);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Split 0: content has 3 lines but line range indicates 2');
    });
    
    it('should detect overlapping splits', () => {
        const splits: CodeSplit[] = [
            {
                content: 'line 1\nline 2',
                startLine: 1,
                endLine: 2,
                tokenCount: 5
            },
            {
                content: 'line 2\nline 3', // Overlaps with previous
                startLine: 2,
                endLine: 3,
                tokenCount: 5
            }
        ];
        
        const result = validateSplits(splits, 1, 3);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Overlap between splits: 2 >= 2');
    });
    
    it('should detect invalid token counts', () => {
        const splits: CodeSplit[] = [
            {
                content: 'test',
                startLine: 1,
                endLine: 1,
                tokenCount: 0 // Invalid
            }
        ];
        
        const result = validateSplits(splits, 1, 1);
        
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Split 0: invalid token count 0');
    });
});

describe('integration with real TypeScript code', () => {
    let tokenizer: any;
    
    beforeEach(() => {
        tokenizer = createTokenizer('text-embedding-3-large');
    });
    
    it('should handle complex TypeScript code', () => {
        const sourceCode = `import { Component } from '@angular/core';

@Component({
  selector: 'app-example',
  template: \`
    <div class="container">
      <h1>{{ title }}</h1>
      <button (click)="onClick()">Click me</button>
    </div>
  \`
})
export class ExampleComponent {
  title = 'Hello World';
  
  onClick(): void {
    console.log('Button clicked!');
  }
}`;
        
        const options: SplitOptions = {
            sourceCode,
            startLine: 1,
            maxTokens: 50,
            tokenizer
        };
        
        const splits = splitCode(options);
        
        expect(splits.length).toBeGreaterThan(0);
        
        // Verify all splits are valid
        splits.forEach(split => {
            expect(split.tokenCount).toBeLessThanOrEqual(50);
            expect(split.startLine).toBeLessThanOrEqual(split.endLine);
            expect(split.content.trim().length).toBeGreaterThan(0);
        });
        
        // Verify complete coverage
        const validation = validateSplits(splits, 1, sourceCode.split('\n').length);
        expect(validation.isValid).toBe(true);
    });
    
    it('should handle code with various indentation levels', () => {
        const sourceCode = `class NestedExample {
    constructor() {
        if (true) {
            for (let i = 0; i < 10; i++) {
                if (i % 2 === 0) {
                    console.log(\`Even: \${i}\`);
                } else {
                    console.log(\`Odd: \${i}\`);
                }
            }
        }
    }
}`;
        
        const options: SplitOptions = {
            sourceCode,
            startLine: 1,
            maxTokens: 30,
            tokenizer
        };
        
        const splits = splitCode(options);
        
        expect(splits.length).toBeGreaterThan(0);
        
        // Verify that splits maintain reasonable structure
        splits.forEach(split => {
            expect(split.tokenCount).toBeLessThanOrEqual(30);
            expect(split.startLine).toBeLessThanOrEqual(split.endLine);
            expect(split.content.trim().length).toBeGreaterThan(0);
            
            // Verify that the content is valid (no broken syntax due to splitting)
            const lines = split.content.split('\n');
            expect(lines.length).toBe(split.endLine - split.startLine + 1);
        });
    });
});