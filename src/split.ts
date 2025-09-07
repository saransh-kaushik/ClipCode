/**
 * Token-aware code splitting functionality
 * Implements line-by-line splitting logic that respects token limits
 */

import { CodeSplit, SplitOptions } from './types';
import { Tokenizer } from './tokenizer';
import { TokenProcessingError } from './errors';

/**
 * Splits source code into chunks that respect token limits while preserving line boundaries.
 * Handles edge cases like empty lines and very long single lines.
 * 
 * @param options - Configuration for the splitting operation
 * @returns Array of CodeSplit objects with content and line tracking
 */
export function splitCode(options: SplitOptions): CodeSplit[] {
    const { sourceCode, startLine, maxTokens, tokenizer } = options;
    
    if (!sourceCode || sourceCode.trim().length === 0) {
        return [];
    }
    
    if (maxTokens <= 0) {
        throw new TokenProcessingError('maxTokens must be greater than 0');
    }
    
    const lines = sourceCode.split('\n');
    const splits: CodeSplit[] = [];
    
    let currentChunk: string[] = [];
    let currentStartLine = startLine;
    let currentTokenCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = startLine + i;
        
        // Handle empty lines - add them to current chunk without token counting
        if (line.trim().length === 0) {
            currentChunk.push(line);
            continue;
        }
        
        const lineTokens = tokenizer.countTokens(line);
        
        // Handle very long single lines that exceed maxTokens
        if (lineTokens > maxTokens) {
            // Flush current chunk if it has content using helper
            if (currentChunk.length > 0) {
                flushChunk(splits, currentChunk, currentStartLine, lineNumber - 1, currentTokenCount);
                currentChunk = [];
                currentTokenCount = 0;
                currentStartLine = lineNumber;
            }
            
            // Split the long line into smaller chunks
            const lineSplits = splitLongLine(line, lineNumber, maxTokens, tokenizer);
            splits.push(...lineSplits);
            
            // Reset for next chunk
            currentStartLine = lineNumber + 1;
            continue;
        }
        
        // Check if adding this line would exceed the token limit
        const potentialTokenCount = currentTokenCount + lineTokens;
        
        if (potentialTokenCount > maxTokens && currentChunk.length > 0) {
            // Flush current chunk using helper
            flushChunk(splits, currentChunk, currentStartLine, lineNumber - 1, currentTokenCount);
            
            // Start new chunk with current line
            currentChunk = [line];
            currentTokenCount = lineTokens;
            currentStartLine = lineNumber;
        } else {
            // Add line to current chunk
            currentChunk.push(line);
            currentTokenCount = potentialTokenCount;
        }
    }
    
    // Flush remaining chunk using helper
    if (currentChunk.length > 0) {
        flushChunk(splits, currentChunk, currentStartLine, startLine + lines.length - 1, currentTokenCount);
    }
    
    return splits;
}

/**
 * Splits a single line that exceeds the token limit into smaller chunks.
 * This handles the edge case of very long single lines.
 * 
 * @param line - The line to split
 * @param lineNumber - The line number in the original file
 * @param maxTokens - Maximum tokens per chunk
 * @param tokenizer - Tokenizer instance for counting tokens
 * @returns Array of CodeSplit objects for the line parts
 */
function splitLongLine(
    line: string, 
    lineNumber: number, 
    maxTokens: number, 
    tokenizer: Tokenizer
): CodeSplit[] {
    const splits: CodeSplit[] = [];
    
    // Try to split by common delimiters first (spaces, commas, semicolons)
    const delimiters = [' ', ',', ';', '(', ')', '{', '}', '[', ']'];
    let remainingText = line;
    let partStartIndex = 0;
    
    while (remainingText.length > 0) {
        let bestSplit = findBestSplit(remainingText, maxTokens, tokenizer, delimiters);
        
        if (bestSplit.length === 0) {
            // If no good split found, take as much as possible character by character
            bestSplit = findCharacterSplit(remainingText, maxTokens, tokenizer);
        }
        
        if (bestSplit.length === 0) {
            // If even character splitting fails, take at least one character to avoid infinite loop
            bestSplit = remainingText.charAt(0);
        }
        
        const tokenCount = tokenizer.countTokens(bestSplit);
        splits.push({
            content: bestSplit,
            startLine: lineNumber,
            endLine: lineNumber,
            tokenCount
        });
        
        remainingText = remainingText.slice(bestSplit.length);
    }
    
    return splits;
}

/**
 * Finds the best split point for a long line using delimiters.
 * 
 * @param text - Text to split
 * @param maxTokens - Maximum tokens allowed
 * @param tokenizer - Tokenizer instance
 * @param delimiters - Array of delimiter characters to try
 * @returns The best substring that fits within token limits
 */
function findBestSplit(
    text: string, 
    maxTokens: number, 
    tokenizer: Tokenizer, 
    delimiters: string[]
): string {
    let bestSplit = '';
    
    // Try each delimiter
    for (const delimiter of delimiters) {
        const parts = text.split(delimiter);
        let currentPart = '';
        
        for (let i = 0; i < parts.length; i++) {
            const testPart = i === 0 ? parts[i] : currentPart + delimiter + parts[i];
            
            if (tokenizer.countTokens(testPart) <= maxTokens) {
                currentPart = testPart;
            } else {
                break;
            }
        }
        
        // Keep the longest valid split
        if (currentPart.length > bestSplit.length) {
            bestSplit = currentPart;
        }
    }
    
    return bestSplit;
}

/**
 * Finds the maximum number of characters that fit within token limits.
 * This is a fallback when delimiter-based splitting doesn't work.
 * 
 * @param text - Text to split
 * @param maxTokens - Maximum tokens allowed
 * @param tokenizer - Tokenizer instance
 * @returns The longest substring that fits within token limits
 */
function findCharacterSplit(text: string, maxTokens: number, tokenizer: Tokenizer): string {
    let left = 0;
    let right = text.length;
    let bestLength = 0;
    
    // Binary search for the maximum length that fits
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const substring = text.slice(0, mid);
        
        if (tokenizer.countTokens(substring) <= maxTokens) {
            bestLength = mid;
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    
    return text.slice(0, bestLength);
}

/**
 * Helper function to flush a chunk and reset tracking variables.
 * Used internally by splitCode to manage chunk creation.
 * 
 * @param chunks - Array to add the chunk to
 * @param lines - Array of lines in the current chunk
 * @param startLine - Starting line number of the chunk
 * @param endLine - Ending line number of the chunk
 * @param tokenCount - Token count of the chunk
 */
export function flushChunk(
    chunks: CodeSplit[],
    lines: string[],
    startLine: number,
    endLine: number,
    tokenCount: number
): void {
    if (lines.length === 0) {
        return;
    }
    
    const content = lines.join('\n');
    
    // Only add chunks with non-blank content
    if (content.trim().length > 0) {
        chunks.push({
            content,
            startLine,
            endLine,
            tokenCount
        });
    }
}

/**
 * Validates that a split result maintains proper line number tracking.
 * Useful for testing and debugging.
 * 
 * @param splits - Array of CodeSplit objects to validate
 * @param originalStartLine - Starting line of the original content
 * @param originalEndLine - Ending line of the original content
 * @returns Validation result
 */
export function validateSplits(
    splits: CodeSplit[],
    originalStartLine: number,
    originalEndLine: number
): {
    isValid: boolean;
    errors: string[];
    totalLines: number;
    coveredLines: number;
} {
    const errors: string[] = [];
    let coveredLines = 0;
    
    // Check each split
    for (let i = 0; i < splits.length; i++) {
        const split = splits[i];
        
        // Validate line numbers
        if (split.startLine > split.endLine) {
            errors.push(`Split ${i}: startLine (${split.startLine}) > endLine (${split.endLine})`);
        }
        
        // Validate content matches line count
        const contentLines = split.content.split('\n').length;
        const expectedLines = split.endLine - split.startLine + 1;
        if (contentLines !== expectedLines) {
            errors.push(`Split ${i}: content has ${contentLines} lines but line range indicates ${expectedLines}`);
        }
        
        // Validate token count
        if (split.tokenCount <= 0) {
            errors.push(`Split ${i}: invalid token count ${split.tokenCount}`);
        }
        
        coveredLines += expectedLines;
    }
    
    // Check for gaps or overlaps
    const sortedSplits = [...splits].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sortedSplits.length; i++) {
        const prev = sortedSplits[i - 1];
        const current = sortedSplits[i];
        
        if (prev.endLine >= current.startLine) {
            errors.push(`Overlap between splits: ${prev.endLine} >= ${current.startLine}`);
        }
    }
    
    const totalLines = originalEndLine - originalStartLine + 1;
    
    return {
        isValid: errors.length === 0,
        errors,
        totalLines,
        coveredLines
    };
}