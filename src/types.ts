/**
 * Core data structures for the code chunking system
 */

// Chunk type categorization
export type ChunkType = 'ast_node' | 'gap' | 'split';

// Error type categorization
export type ErrorType = 'file_system' | 'parsing' | 'token_processing' | 'database';

/**
 * Metadata structure for enhanced search capabilities
 */
export interface ChunkMetadata {
  filePath: string;         // Relative path from repository root
  language: string;         // Programming language
  symbolName?: string;      // Function/class/interface name
  symbolType?: string;      // Type of symbol (function, class, etc.)
  parentLineage?: string[]; // Hierarchy of parent symbols
  chunkType: ChunkType;     // How this chunk was created
  startLine: number;        // Starting line in source file
  endLine: number;          // Ending line in source file
  imports?: string[];       // Imported modules/symbols
  exports?: string[];       // Exported symbols
}

/**
 * Primary chunk representation
 */
export interface FileChunk {
  content: string;           // The actual code content
  metadata: ChunkMetadata;   // Rich metadata for search
  startLine: number;         // Starting line in source file
  endLine: number;          // Ending line in source file
  tokenCount: number;       // Actual token count
}

/**
 * Processing context for file chunking operations
 */
export interface ProcessingContext {
  filePath: string;
  sourceCode: string;
  astNodes: ASTNode[];
  gaps: CodeGap[];
  tokenizer: any;           // tiktoken tokenizer instance
  maxTokens: number;
}

/**
 * AST node representation
 */
export interface ASTNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
}

/**
 * Code gap between AST nodes
 */
export interface CodeGap {
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * Code split result from token-aware splitting
 */
export interface CodeSplit {
  content: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
}

/**
 * Options for chunking a file
 */
export interface ChunkFileOptions {
  filePath: string;
  maxTokens: number;
  modelName: string;
}

/**
 * Options for splitting code based on token limits
 */
export interface SplitOptions {
  sourceCode: string;
  startLine: number;
  maxTokens: number;
  tokenizer: any;
}

/**
 * Context for metadata enrichment
 */
export interface MetadataContext {
  filePath: string;
  language: string;
  astNode?: ASTNode;
  parentSymbols?: string[];
}

/**
 * Language-specific configuration
 */
export interface LanguageConfig {
  name: string;
  extensions: string[];
  parser: any;              // Tree-sitter language object
  wantedNodes: Set<string>; // AST node types to extract
  symbolExtractors?: {      // Functions to extract symbol names
    [nodeType: string]: (node: any) => string;
  };
}

/**
 * Chunk configuration (existing interface enhanced)
 */
export interface ChunkConfig {
  language: any;            // Tree-sitter language object
  name: string;
  wantedNodes: Set<string>;
}

/**
 * Repository scanning options
 */
export interface ScanOptions {
  rootPath: string;
  extensions: string[];
  excludePatterns: string[];
}

/**
 * Processing error interface (defined here to avoid circular dependency)
 */
export interface ProcessingError {
  type: ErrorType;
  filePath?: string;
  message: string;
  stack?: string;
  recoverable: boolean;
  timestamp: Date;
}

/**
 * Processing statistics
 */
export interface ProcessingStats {
  filesProcessed: number;
  chunksCreated: number;
  errors: ProcessingError[];
}

/**
 * Chroma integration configuration
 */
export interface ChromaConfig {
  collectionName: string;
  embeddingModel: string;
  batchSize: number;
}

/**
 * Chroma-compatible chunk format
 */
export interface ChromaChunk {
  id: string;
  document: string;
  metadata: Record<string, any>;
}

/**
 * Global system configuration
 */
export interface SystemConfig {
  languages: LanguageConfig[];
  defaultMaxTokens: number;
  defaultModel: string;
  chroma: ChromaConfig;
  processing: {
    concurrency: number;
    batchSize: number;
    excludePatterns: string[];
  };
}