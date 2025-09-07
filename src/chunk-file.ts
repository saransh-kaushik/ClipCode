import { LANG_CONFIG } from "./chunk";
import { FileChunk, ChunkFileOptions, ASTNode, CodeGap, ChunkMetadata } from "./types";
import { FileSystemError, ParsingError } from "./errors";
import { createTokenizer } from "./tokenizer";
import { splitCode } from "./split";
import path from "path";
import fs from "fs";
import Parser, { SyntaxNode } from "tree-sitter";



function chunkFile(options: ChunkFileOptions): FileChunk[] {
    const { filePath, maxTokens, modelName } = options;
    
    try {
        // Determine the file's extension
        const fileExtension = path.extname(filePath);

        // Grab the corresponding tree sitter language config
        const langConfig = LANG_CONFIG[fileExtension];
        if (!langConfig) {
            // Return empty array for unsupported file types
            return [];
        }

        // Read the file's content
        let fileContent: string;
        try {
            fileContent = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            throw new FileSystemError(
                `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Parse the file using tree sitter
        const parser = new Parser();
        parser.setLanguage(langConfig.language);
        
        let tree;
        try {
            tree = parser.parse(fileContent);
        } catch (error) {
            throw new ParsingError(
                `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        // Create tokenizer for this model
        const tokenizer = createTokenizer(modelName);

        try {
            // Collect AST nodes with symbol information
            const astNodes = collectTreeNodesWithSymbols(tree.rootNode, langConfig.wantedNodes);

            // Process file with cursor tracking for complete coverage
            const allChunks = processFileWithCursor(
                fileContent, 
                astNodes, 
                filePath, 
                langConfig.name, 
                maxTokens, 
                tokenizer
            );

            return allChunks;
        } finally {
            // Clean up tokenizer resources
            tokenizer.dispose();
        }
    } catch (error) {
        if (error instanceof FileSystemError || error instanceof ParsingError) {
            throw error;
        }
        throw new ParsingError(
            `Unexpected error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}



/**
 * Recursively traverses the AST and collects nodes matching the wanted node types.
 * Sorts the collected nodes by their starting line numbers for sequential processing.
 * 
 * @param node - The Tree-sitter syntax node to traverse
 * @param wantedNodes - Set of node types to collect
 * @returns Array of ASTNode objects sorted by line number
 */
function collectTreeNodes(
    node: SyntaxNode,
    wantedNodes: Set<string>,
): ASTNode[] {
    const treeNodes: ASTNode[] = [];
    
    // Check if current node is a wanted type
    if (wantedNodes.has(node.type)) {
        treeNodes.push({
            type: node.type,
            startPosition: { row: node.startPosition.row, column: node.startPosition.column },
            endPosition: { row: node.endPosition.row, column: node.endPosition.column },
            text: node.text
        });
    }
    
    // Always traverse children to find nested wanted nodes
    for (const child of node.children) {
        treeNodes.push(...collectTreeNodes(child, wantedNodes));
    }
    
    // Sort nodes by starting line number for sequential processing
    return treeNodes.sort((a, b) => {
        if (a.startPosition.row !== b.startPosition.row) {
            return a.startPosition.row - b.startPosition.row;
        }
        // If same line, sort by column
        return a.startPosition.column - b.startPosition.column;
    });
}

/**
 * Processes AST nodes into FileChunk objects with comprehensive metadata.
 * Handles token-aware splitting for large nodes while preserving metadata.
 */
function processASTNodes(
    astNodes: (ASTNode & { symbolName?: string; symbolType?: string; parentLineage?: string[] })[],
    filePath: string,
    language: string,
    maxTokens: number,
    tokenizer: any
): FileChunk[] {
    const chunks: FileChunk[] = [];

    for (const node of astNodes) {
        const nodeStartLine = node.startPosition.row + 1; // Convert to 1-based
        const nodeEndLine = node.endPosition.row + 1;

        // Extract imports and exports from the node content
        const { imports, exports } = extractImportsExports(node.text, node.type);

        // Check if node content exceeds token limit
        const tokenCount = tokenizer.countTokens(node.text);
        
        if (tokenCount <= maxTokens) {
            // Node fits within token limit, create single chunk
            const metadata: ChunkMetadata = {
                filePath,
                language,
                symbolName: node.symbolName,
                symbolType: node.symbolType,
                parentLineage: node.parentLineage,
                chunkType: 'ast_node',
                startLine: nodeStartLine,
                endLine: nodeEndLine,
                imports: imports.length > 0 ? imports : undefined,
                exports: exports.length > 0 ? exports : undefined
            };

            chunks.push({
                content: node.text,
                metadata,
                startLine: nodeStartLine,
                endLine: nodeEndLine,
                tokenCount
            });
        } else {
            // Node exceeds token limit, split it
            const splits = splitCode({
                sourceCode: node.text,
                startLine: nodeStartLine,
                maxTokens,
                tokenizer
            });

            // Convert splits to FileChunks with AST node metadata
            for (const split of splits) {
                const metadata: ChunkMetadata = {
                    filePath,
                    language,
                    symbolName: node.symbolName,
                    symbolType: node.symbolType,
                    parentLineage: node.parentLineage,
                    chunkType: 'split',
                    startLine: split.startLine,
                    endLine: split.endLine,
                    imports: imports.length > 0 ? imports : undefined,
                    exports: exports.length > 0 ? exports : undefined
                };

                chunks.push({
                    content: split.content,
                    metadata,
                    startLine: split.startLine,
                    endLine: split.endLine,
                    tokenCount: split.tokenCount
                });
            }
        }
    }

    return chunks;
}

/**
 * Extracts import and export information from code content.
 * This provides additional metadata for better search capabilities.
 * 
 * @param content - The code content to analyze
 * @param nodeType - The AST node type for context
 * @returns Object containing arrays of imports and exports
 */
function extractImportsExports(content: string, nodeType: string): { imports: string[]; exports: string[] } {
    const imports: string[] = [];
    const exports: string[] = [];
    
    // Simple regex-based extraction for common patterns
    // This could be enhanced with proper AST parsing for more accuracy
    
    // Extract import statements
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"`]([^'"`]+)['"`]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
        imports.push(importMatch[1]);
    }
    
    // Extract named imports
    const namedImportRegex = /import\s+\{([^}]+)\}/g;
    let namedMatch;
    while ((namedMatch = namedImportRegex.exec(content)) !== null) {
        const namedImports = namedMatch[1].split(',').map(s => s.trim().split(' as ')[0].trim());
        imports.push(...namedImports);
    }
    
    // Extract default imports
    const defaultImportRegex = /import\s+(\w+)\s+from/g;
    let defaultMatch;
    while ((defaultMatch = defaultImportRegex.exec(content)) !== null) {
        imports.push(defaultMatch[1]);
    }
    
    // Extract export statements
    const exportRegex = /export\s+(?:default\s+)?(?:(?:class|function|interface|type|const|let|var)\s+)?(\w+)/g;
    let exportMatch;
    while ((exportMatch = exportRegex.exec(content)) !== null) {
        if (exportMatch[1] !== 'default') {
            exports.push(exportMatch[1]);
        }
    }
    
    // Extract named exports
    const namedExportRegex = /export\s+\{([^}]+)\}/g;
    let namedExportMatch;
    while ((namedExportMatch = namedExportRegex.exec(content)) !== null) {
        const namedExports = namedExportMatch[1].split(',').map(s => s.trim().split(' as ')[0].trim());
        exports.push(...namedExports);
    }
    
    return {
        imports: [...new Set(imports)], // Remove duplicates
        exports: [...new Set(exports)]  // Remove duplicates
    };
}

/**
 * Processes an entire file using cursor tracking to ensure complete coverage.
 * This approach guarantees no code sections are missed during processing.
 * 
 * @param fileContent - The complete source code content
 * @param astNodes - Array of AST nodes found in the file
 * @param filePath - Path to the file being processed
 * @param language - Programming language of the file
 * @param maxTokens - Maximum tokens per chunk
 * @param tokenizer - Tokenizer instance for token counting
 * @returns Array of FileChunk objects covering the entire file
 */
function processFileWithCursor(
    fileContent: string,
    astNodes: (ASTNode & { symbolName?: string; symbolType?: string; parentLineage?: string[] })[],
    filePath: string,
    language: string,
    maxTokens: number,
    tokenizer: any
): FileChunk[] {
    const chunks: FileChunk[] = [];
    const sourceLines = fileContent.split('\n');
    let cursor = 1; // 1-based line numbering for user-friendly output
    
    // Sort nodes by line number to process sequentially
    const sortedNodes = [...astNodes].sort((a, b) => {
        if (a.startPosition.row !== b.startPosition.row) {
            return a.startPosition.row - b.startPosition.row;
        }
        return a.startPosition.column - b.startPosition.column;
    });
    
    for (const node of sortedNodes) {
        const nodeStartLine = node.startPosition.row + 1; // Convert to 1-based
        const nodeEndLine = node.endPosition.row + 1;
        
        // Process any gap before this node
        if (cursor < nodeStartLine) {
            const gapEndLine = nodeStartLine - 1;
            const gapContent = sourceLines.slice(cursor - 1, gapEndLine).join('\n');
            
            if (gapContent.trim().length > 0) {
                const gapChunks = processGapContent(
                    gapContent,
                    cursor,
                    gapEndLine,
                    filePath,
                    language,
                    maxTokens,
                    tokenizer
                );
                chunks.push(...gapChunks);
            }
        }
        
        // Process the AST node
        const nodeChunks = processASTNodeContent(
            node,
            filePath,
            language,
            maxTokens,
            tokenizer
        );
        chunks.push(...nodeChunks);
        
        // Update cursor to after this node
        cursor = nodeEndLine + 1;
    }
    
    // Process any trailing code after the last node
    if (cursor <= sourceLines.length) {
        const trailingContent = sourceLines.slice(cursor - 1).join('\n');
        
        if (trailingContent.trim().length > 0) {
            const trailingChunks = processGapContent(
                trailingContent,
                cursor,
                sourceLines.length,
                filePath,
                language,
                maxTokens,
                tokenizer
            );
            chunks.push(...trailingChunks);
        }
    }
    
    // Sort final chunks by line number
    chunks.sort((a, b) => a.startLine - b.startLine);
    
    return chunks;
}

/**
 * Processes a single AST node into FileChunk objects.
 * Handles token-aware splitting for large nodes while preserving metadata.
 */
function processASTNodeContent(
    node: ASTNode & { symbolName?: string; symbolType?: string; parentLineage?: string[] },
    filePath: string,
    language: string,
    maxTokens: number,
    tokenizer: any
): FileChunk[] {
    const chunks: FileChunk[] = [];
    const nodeStartLine = node.startPosition.row + 1; // Convert to 1-based
    const nodeEndLine = node.endPosition.row + 1;

    // Extract imports and exports from the node content
    const { imports, exports } = extractImportsExports(node.text, node.type);

    // Check if node content exceeds token limit
    const tokenCount = tokenizer.countTokens(node.text);
    
    if (tokenCount <= maxTokens) {
        // Node fits within token limit, create single chunk
        const metadata: ChunkMetadata = {
            filePath,
            language,
            symbolName: node.symbolName,
            symbolType: node.symbolType,
            parentLineage: node.parentLineage,
            chunkType: 'ast_node',
            startLine: nodeStartLine,
            endLine: nodeEndLine,
            imports: imports.length > 0 ? imports : undefined,
            exports: exports.length > 0 ? exports : undefined
        };

        chunks.push({
            content: node.text,
            metadata,
            startLine: nodeStartLine,
            endLine: nodeEndLine,
            tokenCount
        });
    } else {
        // Node exceeds token limit, split it
        const splits = splitCode({
            sourceCode: node.text,
            startLine: nodeStartLine,
            maxTokens,
            tokenizer
        });

        // Convert splits to FileChunks with AST node metadata
        for (const split of splits) {
            const metadata: ChunkMetadata = {
                filePath,
                language,
                symbolName: node.symbolName,
                symbolType: node.symbolType,
                parentLineage: node.parentLineage,
                chunkType: 'split',
                startLine: split.startLine,
                endLine: split.endLine,
                imports: imports.length > 0 ? imports : undefined,
                exports: exports.length > 0 ? exports : undefined
            };

            chunks.push({
                content: split.content,
                metadata,
                startLine: split.startLine,
                endLine: split.endLine,
                tokenCount: split.tokenCount
            });
        }
    }

    return chunks;
}

/**
 * Processes gap content (code between AST nodes) into FileChunk objects.
 * Handles token-aware splitting for large gaps while preserving metadata.
 */
function processGapContent(
    gapContent: string,
    startLine: number,
    endLine: number,
    filePath: string,
    language: string,
    maxTokens: number,
    tokenizer: any
): FileChunk[] {
    const chunks: FileChunk[] = [];

    // Extract imports and exports from the gap content
    const { imports, exports } = extractImportsExports(gapContent, 'gap');

    // Check if gap content exceeds token limit
    const tokenCount = tokenizer.countTokens(gapContent);
    
    if (tokenCount <= maxTokens) {
        // Gap fits within token limit, create single chunk
        const metadata: ChunkMetadata = {
            filePath,
            language,
            chunkType: 'gap',
            startLine,
            endLine,
            imports: imports.length > 0 ? imports : undefined,
            exports: exports.length > 0 ? exports : undefined
        };

        chunks.push({
            content: gapContent,
            metadata,
            startLine,
            endLine,
            tokenCount
        });
    } else {
        // Gap exceeds token limit, split it
        const splits = splitCode({
            sourceCode: gapContent,
            startLine,
            maxTokens,
            tokenizer
        });

        // Convert splits to FileChunks with gap metadata
        for (const split of splits) {
            const metadata: ChunkMetadata = {
                filePath,
                language,
                chunkType: 'split',
                startLine: split.startLine,
                endLine: split.endLine,
                imports: imports.length > 0 ? imports : undefined,
                exports: exports.length > 0 ? exports : undefined
            };

            chunks.push({
                content: split.content,
                metadata,
                startLine: split.startLine,
                endLine: split.endLine,
                tokenCount: split.tokenCount
            });
        }
    }

    return chunks;
}

/**
 * Processes code gaps into FileChunk objects with comprehensive metadata.
 * Handles token-aware splitting for large gaps while preserving metadata.
 * 
 * @deprecated Use processFileWithCursor for better cursor tracking
 */
function processGaps(
    gaps: CodeGap[],
    filePath: string,
    language: string,
    maxTokens: number,
    tokenizer: any
): FileChunk[] {
    const chunks: FileChunk[] = [];

    for (const gap of gaps) {
        const gapChunks = processGapContent(
            gap.content,
            gap.startLine,
            gap.endLine,
            filePath,
            language,
            maxTokens,
            tokenizer
        );
        chunks.push(...gapChunks);
    }

    return chunks;
}

// Export functions for testing and external use
export { 
    chunkFile,
    collectTreeNodes, 
    extractSymbolName, 
    extractSymbolType, 
    collectTreeNodesWithSymbols,
    extractGaps,
    getCompleteFileCoverage,
    validateFileCoverage,
    processASTNodes,
    processGaps,
    extractImportsExports,
    isContainerNode,
    processFileWithCursor,
    processASTNodeContent,
    processGapContent
};
/**
 
* Extracts the symbol name from an AST node based on its type.
 * Handles different node types like functions, classes, interfaces, etc.
 * 
 * @param node - The Tree-sitter syntax node
 * @returns The symbol name or undefined if not extractable
 */
function extractSymbolName(node: SyntaxNode): string | undefined {
    switch (node.type) {
        case 'function_declaration':
            // Find the identifier child node for function name
            const functionName = node.children.find(child => child.type === 'identifier');
            return functionName?.text;
            
        case 'class_declaration':
            // Find the type_identifier child node for class name
            const className = node.children.find(child => child.type === 'type_identifier');
            return className?.text;
            
        case 'interface_declaration':
            // Find the type_identifier child node for interface name
            const interfaceName = node.children.find(child => child.type === 'type_identifier');
            return interfaceName?.text;
            
        case 'type_alias_declaration':
            // Find the type_identifier child node for type alias name
            const typeAliasName = node.children.find(child => child.type === 'type_identifier');
            return typeAliasName?.text;
            
        case 'method_definition':
            // Find the property_identifier child node for method name
            const methodName = node.children.find(child => child.type === 'property_identifier');
            return methodName?.text;
            
        case 'arrow_function':
            // Arrow functions are often anonymous, but we can try to find if it's assigned to a variable
            // This is a more complex case that would require looking at the parent context
            return undefined; // Will be handled in enhanced metadata extraction
            
        case 'variable_declaration':
        case 'lexical_declaration':
            // Find the identifier in variable declarator
            const declarator = node.children.find(child => child.type === 'variable_declarator');
            if (declarator) {
                const varName = declarator.children.find(child => child.type === 'identifier');
                return varName?.text;
            }
            return undefined;
            
        case 'export_statement':
            // For export statements, try to find what's being exported
            const exportClause = node.children.find(child => 
                child.type === 'export_clause' || 
                child.type === 'function_declaration' ||
                child.type === 'class_declaration' ||
                child.type === 'interface_declaration'
            );
            if (exportClause && exportClause.type !== 'export_clause') {
                return extractSymbolName(exportClause);
            }
            return undefined;
            
        case 'import_statement':
            // For import statements, we might want to track what's being imported
            const importClause = node.children.find(child => child.type === 'import_clause');
            if (importClause) {
                const defaultImport = importClause.children.find(child => child.type === 'identifier');
                if (defaultImport) {
                    return defaultImport.text;
                }
                // Handle named imports - this is more complex and might return multiple names
                const namedImports = importClause.children.find(child => child.type === 'named_imports');
                if (namedImports) {
                    // For now, return the first import specifier
                    const firstSpecifier = namedImports.children.find(child => child.type === 'import_specifier');
                    if (firstSpecifier) {
                        const specifierName = firstSpecifier.children.find(child => child.type === 'identifier');
                        return specifierName?.text;
                    }
                }
            }
            return undefined;
            
        default:
            return undefined;
    }
}

/**
 * Extracts the symbol type from an AST node.
 * 
 * @param node - The Tree-sitter syntax node
 * @returns The symbol type as a string
 */
function extractSymbolType(node: SyntaxNode): string {
    switch (node.type) {
        case 'function_declaration':
            return 'function';
        case 'class_declaration':
            return 'class';
        case 'interface_declaration':
            return 'interface';
        case 'type_alias_declaration':
            return 'type_alias';
        case 'method_definition':
            return 'method';
        case 'arrow_function':
            return 'arrow_function';
        case 'variable_declaration':
        case 'lexical_declaration':
            return 'variable';
        case 'export_statement':
            return 'export';
        case 'import_statement':
            return 'import';
        default:
            return node.type;
    }
}

/**
 * Enhanced version of collectTreeNodes that includes symbol name and type extraction
 * with parent lineage tracking for nested code structures.
 * 
 * @param node - The Tree-sitter syntax node to traverse
 * @param wantedNodes - Set of node types to collect
 * @param parentLineage - Array of parent symbol names (for recursion)
 * @returns Array of ASTNode objects with enhanced metadata, sorted by line number
 */
function collectTreeNodesWithSymbols(
    node: SyntaxNode,
    wantedNodes: Set<string>,
    parentLineage: string[] = []
): (ASTNode & { symbolName?: string; symbolType?: string; parentLineage?: string[] })[] {
    const treeNodes: (ASTNode & { symbolName?: string; symbolType?: string; parentLineage?: string[] })[] = [];
    
    // Check if current node is a wanted type
    if (wantedNodes.has(node.type)) {
        const symbolName = extractSymbolName(node);
        const symbolType = extractSymbolType(node);
        
        treeNodes.push({
            type: node.type,
            startPosition: { row: node.startPosition.row, column: node.startPosition.column },
            endPosition: { row: node.endPosition.row, column: node.endPosition.column },
            text: node.text,
            symbolName,
            symbolType,
            parentLineage: parentLineage.length > 0 ? [...parentLineage] : undefined
        });
    }
    
    // Determine if this node should be added to parent lineage for children
    const currentSymbolName = extractSymbolName(node);
    const newParentLineage = currentSymbolName && isContainerNode(node.type) 
        ? [...parentLineage, currentSymbolName]
        : parentLineage;
    
    // Always traverse children to find nested wanted nodes
    for (const child of node.children) {
        treeNodes.push(...collectTreeNodesWithSymbols(child, wantedNodes, newParentLineage));
    }
    
    // Sort nodes by starting line number for sequential processing
    return treeNodes.sort((a, b) => {
        if (a.startPosition.row !== b.startPosition.row) {
            return a.startPosition.row - b.startPosition.row;
        }
        // If same line, sort by column
        return a.startPosition.column - b.startPosition.column;
    });
}

/**
 * Determines if a node type represents a container that should be included in parent lineage.
 * Container nodes are those that can contain other symbols (classes, interfaces, namespaces).
 * 
 * @param nodeType - The AST node type
 * @returns True if the node is a container type
 */
function isContainerNode(nodeType: string): boolean {
    const containerTypes = new Set([
        'class_declaration',
        'interface_declaration',
        'namespace_declaration',
        'module_declaration',
        'enum_declaration'
    ]);
    return containerTypes.has(nodeType);
}/**

 * Identifies code gaps between collected AST nodes.
 * Gaps represent code that exists between meaningful constructs like imports, constants, etc.
 * 
 * @param nodes - Array of AST nodes sorted by line number
 * @param sourceCode - The complete source code of the file
 * @returns Array of CodeGap objects representing the gaps between nodes
 */
function extractGaps(nodes: ASTNode[], sourceCode: string): import('./types').CodeGap[] {
    const gaps: import('./types').CodeGap[] = [];
    const sourceLines = sourceCode.split('\n');
    
    if (nodes.length === 0) {
        // If no nodes found, the entire file is a gap
        if (sourceCode.trim().length > 0) {
            gaps.push({
                content: sourceCode,
                startLine: 1,
                endLine: sourceLines.length
            });
        }
        return gaps;
    }
    
    let currentLine = 1; // 1-based line numbering for user-friendly output
    
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const nodeStartLine = node.startPosition.row + 1; // Convert from 0-based to 1-based
        
        // Check if there's a gap before this node
        if (currentLine < nodeStartLine) {
            const gapStartLine = currentLine;
            const gapEndLine = nodeStartLine - 1;
            
            // Extract the gap content
            const gapLines = sourceLines.slice(gapStartLine - 1, gapEndLine);
            const gapContent = gapLines.join('\n');
            
            // Only add non-empty gaps (ignore whitespace-only gaps)
            if (gapContent.trim().length > 0) {
                gaps.push({
                    content: gapContent,
                    startLine: gapStartLine,
                    endLine: gapEndLine
                });
            }
        }
        
        // Update current line to after this node
        currentLine = node.endPosition.row + 2; // +1 for 0-based to 1-based, +1 to go to next line
    }
    
    // Check if there's a gap after the last node
    const lastNode = nodes[nodes.length - 1];
    const lastNodeEndLine = lastNode.endPosition.row + 1; // Convert to 1-based
    
    if (lastNodeEndLine < sourceLines.length) {
        const gapStartLine = lastNodeEndLine + 1;
        const gapEndLine = sourceLines.length;
        
        // Extract the trailing gap content
        const gapLines = sourceLines.slice(gapStartLine - 1, gapEndLine);
        const gapContent = gapLines.join('\n');
        
        // Only add non-empty gaps
        if (gapContent.trim().length > 0) {
            gaps.push({
                content: gapContent,
                startLine: gapStartLine,
                endLine: gapEndLine
            });
        }
    }
    
    return gaps;
}

/**
 * Processes a file to extract both AST nodes and gaps, providing complete file coverage.
 * This ensures no code is missed during the chunking process.
 * 
 * @param sourceCode - The complete source code of the file
 * @param nodes - Array of AST nodes found in the file
 * @returns Object containing both nodes and gaps with their metadata
 */
function getCompleteFileCoverage(
    sourceCode: string, 
    nodes: (ASTNode & { symbolName?: string; symbolType?: string })[]
): {
    nodes: (ASTNode & { symbolName?: string; symbolType?: string })[];
    gaps: import('./types').CodeGap[];
    totalLines: number;
    coveredLines: number;
} {
    const gaps = extractGaps(nodes, sourceCode);
    const sourceLines = sourceCode.split('\n');
    
    // Calculate coverage statistics
    let coveredLines = 0;
    
    // Count lines covered by nodes
    nodes.forEach(node => {
        const nodeLines = (node.endPosition.row - node.startPosition.row) + 1;
        coveredLines += nodeLines;
    });
    
    // Count lines covered by gaps
    gaps.forEach(gap => {
        const gapLines = (gap.endLine - gap.startLine) + 1;
        coveredLines += gapLines;
    });
    
    return {
        nodes,
        gaps,
        totalLines: sourceLines.length,
        coveredLines
    };
}

/**
 * Validates that nodes and gaps provide complete coverage of the source file.
 * This is useful for testing and debugging to ensure no code is missed.
 * 
 * @param sourceCode - The complete source code
 * @param nodes - Array of AST nodes
 * @param gaps - Array of code gaps
 * @returns Validation result with coverage information
 */
function validateFileCoverage(
    sourceCode: string,
    nodes: ASTNode[],
    gaps: import('./types').CodeGap[]
): {
    isComplete: boolean;
    totalLines: number;
    coveredLines: number;
    coveragePercentage: number;
    missingRanges: { startLine: number; endLine: number }[];
} {
    const sourceLines = sourceCode.split('\n');
    const totalLines = sourceLines.length;
    const coveredRanges: { startLine: number; endLine: number }[] = [];
    
    // Add node ranges
    nodes.forEach(node => {
        coveredRanges.push({
            startLine: node.startPosition.row + 1, // Convert to 1-based
            endLine: node.endPosition.row + 1
        });
    });
    
    // Add gap ranges
    gaps.forEach(gap => {
        coveredRanges.push({
            startLine: gap.startLine,
            endLine: gap.endLine
        });
    });
    
    // Sort ranges by start line
    coveredRanges.sort((a, b) => a.startLine - b.startLine);
    
    // Find missing ranges
    const missingRanges: { startLine: number; endLine: number }[] = [];
    let currentLine = 1;
    
    for (const range of coveredRanges) {
        if (currentLine < range.startLine) {
            missingRanges.push({
                startLine: currentLine,
                endLine: range.startLine - 1
            });
        }
        currentLine = Math.max(currentLine, range.endLine + 1);
    }
    
    // Check if there are lines after the last covered range
    if (currentLine <= totalLines) {
        missingRanges.push({
            startLine: currentLine,
            endLine: totalLines
        });
    }
    
    const coveredLines = totalLines - missingRanges.reduce((sum, range) => 
        sum + (range.endLine - range.startLine + 1), 0);
    
    return {
        isComplete: missingRanges.length === 0,
        totalLines,
        coveredLines,
        coveragePercentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 100,
        missingRanges
    };
}