/**
 * Example usage of the repository scanning and batch processing functionality
 */

import { processRepository, printProcessingStats } from './src/batch-processor';
import { scanRepository, createDefaultScanOptions } from './src/repository-scanner';

async function main() {
    try {
        console.log('=== Repository Scanning and Batch Processing Example ===\n');
        
        // Example 1: Simple repository processing
        console.log('1. Processing current repository...');
        const result = await processRepository('.', 1000, 'text-embedding-3-large', 2);
        printProcessingStats(result);
        
        // Example 2: Custom scanning options
        console.log('2. Custom scanning with specific options...');
        const customOptions = {
            rootPath: './src',
            extensions: ['.ts'],
            excludePatterns: ['**/*.test.ts', '**/*.d.ts']
        };
        
        const files = await scanRepository(customOptions);
        console.log(`Found ${files.length} TypeScript files:`);
        files.slice(0, 5).forEach(file => console.log(`  - ${file}`));
        if (files.length > 5) {
            console.log(`  ... and ${files.length - 5} more`);
        }
        
        console.log('\n=== Example completed successfully ===');
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Run the example if this file is executed directly
if (require.main === module) {
    main();
}