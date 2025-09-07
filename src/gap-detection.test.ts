import { describe, it, expect, beforeEach } from 'vitest';
import Parser from 'tree-sitter';
import TSLang from 'tree-sitter-typescript';
import { 
    collectTreeNodesWithSymbols, 
    extractGaps, 
    getCompleteFileCoverage, 
    validateFileCoverage 
} from './chunk-file';
import { ASTNode, CodeGap } from './types';

describe('Gap Detection', () => {
    let parser: Parser;
    
    beforeEach(() => {
        parser = new Parser();
        parser.setLanguage(TSLang.typescript);
    });

    describe('extractGaps', () => {
        it('should identify gaps between functions', () => {
            const code = `// File header comment
import { something } from './module';

const CONSTANT = 42;

function firstFunction() {
    return "first";
}

// Comment between functions
const anotherConstant = "hello";

function secondFunction() {
    return "second";
}

// Trailing comment`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const gaps = extractGaps(nodes, code);

            expect(gaps).toHaveLength(3);
            
            // First gap: everything before first function
            expect(gaps[0].content).toContain('// File header comment');
            expect(gaps[0].content).toContain('import { something }');
            expect(gaps[0].content).toContain('const CONSTANT = 42;');
            expect(gaps[0].startLine).toBe(1);
            
            // Second gap: between functions
            expect(gaps[1].content).toContain('// Comment between functions');
            expect(gaps[1].content).toContain('const anotherConstant = "hello";');
            
            // Third gap: after last function
            expect(gaps[2].content).toContain('// Trailing comment');
        });

        it('should handle file with no AST nodes', () => {
            const code = `// Just comments
const variable = 42;
// More comments`;

            const nodes: ASTNode[] = [];
            const gaps = extractGaps(nodes, code);

            expect(gaps).toHaveLength(1);
            expect(gaps[0].content).toBe(code);
            expect(gaps[0].startLine).toBe(1);
            expect(gaps[0].endLine).toBe(3);
        });

        it('should handle file with only AST nodes (no gaps)', () => {
            const code = `function onlyFunction() {
    return true;
}`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const gaps = extractGaps(nodes, code);

            expect(gaps).toHaveLength(0);
        });

        it('should ignore whitespace-only gaps', () => {
            const code = `function first() {
    return 1;
}


function second() {
    return 2;
}`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const gaps = extractGaps(nodes, code);

            // Should not create a gap for the empty lines between functions
            expect(gaps).toHaveLength(0);
        });

        it('should handle complex file with multiple node types', () => {
            const code = `// Header
import React from 'react';

interface Props {
    name: string;
}

const DEFAULT_NAME = "Anonymous";

class Component extends React.Component<Props> {
    render() {
        return <div>{this.props.name}</div>;
    }
}

export default Component;`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['interface_declaration', 'class_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const gaps = extractGaps(nodes, code);

            expect(gaps.length).toBeGreaterThan(0);
            
            // Should capture imports and constants
            const firstGap = gaps[0];
            expect(firstGap.content).toContain('// Header');
            expect(firstGap.content).toContain('import React');
            
            // Should capture constants between interface and class
            const middleGap = gaps.find(gap => gap.content.includes('DEFAULT_NAME'));
            expect(middleGap).toBeDefined();
            expect(middleGap!.content).toContain('const DEFAULT_NAME');
            
            // Should capture export statement
            const lastGap = gaps[gaps.length - 1];
            expect(lastGap.content).toContain('export default Component');
        });

        it('should handle single-line gaps', () => {
            const code = `function first() { return 1; }
const between = 42;
function second() { return 2; }`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const gaps = extractGaps(nodes, code);

            expect(gaps).toHaveLength(1);
            expect(gaps[0].content).toBe('const between = 42;');
            expect(gaps[0].startLine).toBe(2);
            expect(gaps[0].endLine).toBe(2);
        });
    });

    describe('getCompleteFileCoverage', () => {
        it('should provide complete coverage information', () => {
            const code = `// Header comment
function test() {
    return true;
}
// Footer comment`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const coverage = getCompleteFileCoverage(code, nodes);

            expect(coverage.nodes).toHaveLength(1);
            expect(coverage.gaps).toHaveLength(2); // Before and after function
            expect(coverage.totalLines).toBe(5);
            expect(coverage.coveredLines).toBeGreaterThan(0);
            
            // Check that we have both header and footer gaps
            expect(coverage.gaps[0].content).toContain('// Header comment');
            expect(coverage.gaps[1].content).toContain('// Footer comment');
        });

        it('should handle empty file', () => {
            const code = '';
            const nodes: (ASTNode & { symbolName?: string; symbolType?: string })[] = [];
            const coverage = getCompleteFileCoverage(code, nodes);

            expect(coverage.nodes).toHaveLength(0);
            expect(coverage.gaps).toHaveLength(0);
            expect(coverage.totalLines).toBe(1); // Empty file still has one line
            expect(coverage.coveredLines).toBe(0);
        });

        it('should handle file with only whitespace', () => {
            const code = '   \n\n   \n';
            const nodes: (ASTNode & { symbolName?: string; symbolType?: string })[] = [];
            const coverage = getCompleteFileCoverage(code, nodes);

            expect(coverage.nodes).toHaveLength(0);
            expect(coverage.gaps).toHaveLength(0); // Whitespace-only content is ignored
            expect(coverage.totalLines).toBe(4);
        });
    });

    describe('validateFileCoverage', () => {
        it('should validate complete coverage', () => {
            const code = `function test() {
    return true;
}`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const gaps = extractGaps(nodes, code);
            const validation = validateFileCoverage(code, nodes, gaps);

            expect(validation.isComplete).toBe(true);
            expect(validation.coveragePercentage).toBe(100);
            expect(validation.missingRanges).toHaveLength(0);
        });

        it('should detect incomplete coverage', () => {
            const code = `// Header
function test() {
    return true;
}
// Footer`;

            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            // Intentionally don't extract gaps to simulate incomplete coverage
            const gaps: CodeGap[] = [];
            const validation = validateFileCoverage(code, nodes, gaps);

            expect(validation.isComplete).toBe(false);
            expect(validation.coveragePercentage).toBeLessThan(100);
            expect(validation.missingRanges.length).toBeGreaterThan(0);
        });

        it('should calculate coverage percentage correctly', () => {
            const code = `line1
line2
line3
line4`;

            // Simulate covering only 2 out of 4 lines
            const nodes: ASTNode[] = [{
                type: 'test',
                startPosition: { row: 1, column: 0 }, // line 2 (0-based)
                endPosition: { row: 2, column: 0 },   // line 3 (0-based)
                text: 'line2\nline3'
            }];
            const gaps: CodeGap[] = [];
            
            const validation = validateFileCoverage(code, nodes, gaps);
            
            expect(validation.totalLines).toBe(4);
            expect(validation.coveredLines).toBe(2);
            expect(validation.coveragePercentage).toBe(50);
        });

        it('should handle overlapping ranges correctly', () => {
            const code = `line1
line2
line3`;

            const nodes: ASTNode[] = [{
                type: 'test1',
                startPosition: { row: 0, column: 0 },
                endPosition: { row: 1, column: 0 },
                text: 'line1\nline2'
            }];
            
            const gaps: CodeGap[] = [{
                content: 'line2\nline3',
                startLine: 2,
                endLine: 3
            }];
            
            const validation = validateFileCoverage(code, nodes, gaps);
            
            // Should handle the overlap gracefully
            expect(validation.isComplete).toBe(true);
            expect(validation.coveragePercentage).toBe(100);
        });
    });

    describe('Integration: Complete file processing', () => {
        it('should process a realistic TypeScript file completely', () => {
            const code = `/**
 * User management module
 */
import { Database } from './database';
import { Logger } from './logger';

// Configuration constants
const MAX_USERS = 1000;
const DEFAULT_ROLE = 'user';

interface User {
    id: string;
    name: string;
    role: string;
}

class UserManager {
    private db: Database;
    private logger: Logger;
    
    constructor(db: Database, logger: Logger) {
        this.db = db;
        this.logger = logger;
    }
    
    async createUser(name: string): Promise<User> {
        this.logger.info(\`Creating user: \${name}\`);
        
        const user: User = {
            id: generateId(),
            name,
            role: DEFAULT_ROLE
        };
        
        await this.db.save(user);
        return user;
    }
}

function generateId(): string {
    return Math.random().toString(36).substr(2, 9);
}

export { UserManager, User };`;

            const tree = parser.parse(code);
            const wantedNodes = new Set([
                'interface_declaration', 
                'class_declaration', 
                'function_declaration',
                'method_definition'
            ]);
            
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            const coverage = getCompleteFileCoverage(code, nodes);
            const validation = validateFileCoverage(code, coverage.nodes, coverage.gaps);

            // Should find all major constructs
            expect(nodes.length).toBeGreaterThanOrEqual(4); // interface, class, function, methods
            
            // Should have gaps for imports, constants, and exports
            expect(coverage.gaps.length).toBeGreaterThan(0);
            
            // Should achieve high coverage
            expect(validation.coveragePercentage).toBeGreaterThan(90);
            
            // Verify specific constructs are found
            const userInterface = nodes.find(n => n.symbolName === 'User' && n.symbolType === 'interface');
            const userManagerClass = nodes.find(n => n.symbolName === 'UserManager' && n.symbolType === 'class');
            const generateIdFunction = nodes.find(n => n.symbolName === 'generateId' && n.symbolType === 'function');
            
            expect(userInterface).toBeDefined();
            expect(userManagerClass).toBeDefined();
            expect(generateIdFunction).toBeDefined();
            
            // Verify gaps capture important code
            const importsGap = coverage.gaps.find(gap => gap.content.includes('import'));
            const constantsGap = coverage.gaps.find(gap => gap.content.includes('MAX_USERS'));
            const exportsGap = coverage.gaps.find(gap => gap.content.includes('export'));
            
            expect(importsGap).toBeDefined();
            expect(constantsGap).toBeDefined();
            expect(exportsGap).toBeDefined();
        });
    });
});