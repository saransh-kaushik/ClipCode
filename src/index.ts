/**
 * Main exports for the code chunking system
 */

// Core types and interfaces
export * from './types';

// Error handling
export * from './errors';

// Tokenizer utilities
export * from './tokenizer';

// Language configuration
export { LANG_CONFIG } from './chunk';

// Token-aware splitting functionality
export * from './split';

// Core functionality
export { chunkFile } from './chunk-file';
export { collectTreeNodes, collectTreeNodesWithSymbols } from './chunk-file';