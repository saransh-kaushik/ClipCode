/**
 * Test file to verify that all core interfaces and dependencies are working
 */

import { 
  FileChunk, 
  ChunkMetadata, 
  ProcessingContext, 
  ChunkFileOptions,
  ASTNode,
  CodeGap,
  CodeSplit
} from './types';
import { 
  ErrorHandler, 
  FileSystemError, 
  ParsingError, 
  TokenProcessingError,
  DatabaseError 
} from './errors';
import { Tokenizer, createTokenizer, countTokens } from './tokenizer';
import { LANG_CONFIG } from './chunk';

// Test that all interfaces can be instantiated
function testInterfaces() {
  console.log('Testing core interfaces...');

  // Test ChunkMetadata
  const metadata: ChunkMetadata = {
    filePath: 'test.ts',
    language: 'typescript',
    symbolName: 'testFunction',
    symbolType: 'function',
    parentLineage: ['TestClass'],
    chunkType: 'ast_node',
    imports: ['fs', 'path'],
    exports: ['testFunction']
  };

  // Test FileChunk
  const chunk: FileChunk = {
    content: 'function test() { return "hello"; }',
    metadata,
    startLine: 1,
    endLine: 1,
    tokenCount: 10
  };

  // Test ChunkFileOptions
  const options: ChunkFileOptions = {
    filePath: 'test.ts',
    maxTokens: 1000,
    modelName: 'text-embedding-3-large'
  };

  // Test ASTNode
  const astNode: ASTNode = {
    type: 'function_declaration',
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 30 },
    text: 'function test() { return "hello"; }'
  };

  // Test CodeGap
  const gap: CodeGap = {
    content: 'import fs from "fs";',
    startLine: 0,
    endLine: 0
  };

  // Test CodeSplit
  const split: CodeSplit = {
    content: 'const x = 1;',
    startLine: 2,
    endLine: 2,
    tokenCount: 5
  };

  console.log('✓ All interfaces created successfully');
  return { chunk, options, astNode, gap, split };
}

// Test error handling
function testErrorHandling() {
  console.log('Testing error handling...');

  const errorHandler = new ErrorHandler();

  // Test different error types
  const fsError = new FileSystemError('File not found', 'test.ts');
  const parseError = new ParsingError('Syntax error', 'test.ts');
  const tokenError = new TokenProcessingError('Token limit exceeded', 'test.ts');
  const dbError = new DatabaseError('Connection failed');

  errorHandler.addError(fsError);
  errorHandler.addError(parseError);
  errorHandler.addError(tokenError);
  errorHandler.addError(dbError);

  const summary = errorHandler.getSummary();
  console.log('✓ Error handling working correctly');
  console.log(`  - Total errors: ${summary.total}`);
  console.log(`  - By type:`, summary.byType);

  return errorHandler;
}

// Test tokenizer
async function testTokenizer() {
  console.log('Testing tokenizer...');

  try {
    const tokenizer = createTokenizer('text-embedding-3-large');
    const testText = 'function hello() { return "world"; }';
    const tokenCount = tokenizer.countTokens(testText);
    
    console.log('✓ Tokenizer working correctly');
    console.log(`  - Test text: "${testText}"`);
    console.log(`  - Token count: ${tokenCount}`);
    
    tokenizer.dispose();

    // Test utility function
    const utilityCount = countTokens(testText);
    console.log(`  - Utility function count: ${utilityCount}`);

    return tokenCount;
  } catch (error) {
    console.error('✗ Tokenizer test failed:', error);
    throw error;
  }
}

// Test language configuration
function testLanguageConfig() {
  console.log('Testing language configuration...');

  const tsConfig = LANG_CONFIG['.ts'];
  const tsxConfig = LANG_CONFIG['.tsx'];

  if (!tsConfig || !tsxConfig) {
    throw new Error('Language configuration not found');
  }

  console.log('✓ Language configuration loaded');
  console.log(`  - TypeScript config: ${tsConfig.name}`);
  console.log(`  - TSX config: ${tsxConfig.name}`);
  console.log(`  - Wanted nodes count: ${tsConfig.wantedNodes.size}`);

  return { tsConfig, tsxConfig };
}

// Main test function
async function runTests() {
  console.log('=== Code Chunking System Setup Tests ===\n');

  try {
    testInterfaces();
    console.log();

    testErrorHandling();
    console.log();

    await testTokenizer();
    console.log();

    testLanguageConfig();
    console.log();

    console.log('🎉 All tests passed! Core setup is complete.');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

export { runTests };