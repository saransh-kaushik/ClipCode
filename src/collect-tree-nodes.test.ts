import { describe, it, expect, beforeEach } from 'vitest';
import Parser from 'tree-sitter';
import TSLang from 'tree-sitter-typescript';
import { collectTreeNodes } from './chunk-file';
import { ASTNode } from './types';

describe('collectTreeNodes', () => {
    let parser: Parser;
    
    beforeEach(() => {
        parser = new Parser();
        parser.setLanguage(TSLang.typescript);
    });

    it('should collect function declarations', () => {
        const code = `
function hello() {
    return "world";
}

function goodbye() {
    return "farewell";
}
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['function_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(2);
        expect(nodes[0].type).toBe('function_declaration');
        expect(nodes[1].type).toBe('function_declaration');
        expect(nodes[0].text).toContain('function hello()');
        expect(nodes[1].text).toContain('function goodbye()');
    });

    it('should collect class declarations', () => {
        const code = `
class MyClass {
    method() {
        return true;
    }
}

class AnotherClass {
    value = 42;
}
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['class_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(2);
        expect(nodes[0].type).toBe('class_declaration');
        expect(nodes[1].type).toBe('class_declaration');
        expect(nodes[0].text).toContain('class MyClass');
        expect(nodes[1].text).toContain('class AnotherClass');
    });

    it('should collect interface declarations', () => {
        const code = `
interface User {
    name: string;
    age: number;
}

interface Product {
    id: string;
    price: number;
}
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['interface_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(2);
        expect(nodes[0].type).toBe('interface_declaration');
        expect(nodes[1].type).toBe('interface_declaration');
        expect(nodes[0].text).toContain('interface User');
        expect(nodes[1].text).toContain('interface Product');
    });

    it('should collect multiple node types', () => {
        const code = `
interface Config {
    debug: boolean;
}

class Logger {
    log(message: string) {
        console.log(message);
    }
}

function createLogger(): Logger {
    return new Logger();
}
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['interface_declaration', 'class_declaration', 'function_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(3);
        expect(nodes[0].type).toBe('interface_declaration');
        expect(nodes[1].type).toBe('class_declaration');
        expect(nodes[2].type).toBe('function_declaration');
    });

    it('should sort nodes by line number', () => {
        const code = `
function third() { return 3; }

function first() { return 1; }

function second() { return 2; }
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['function_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(3);
        // Nodes should be sorted by their starting line position
        expect(nodes[0].startPosition.row).toBeLessThan(nodes[1].startPosition.row);
        expect(nodes[1].startPosition.row).toBeLessThan(nodes[2].startPosition.row);
        expect(nodes[0].text).toContain('function third()');
        expect(nodes[1].text).toContain('function first()');
        expect(nodes[2].text).toContain('function second()');
    });

    it('should collect nested nodes', () => {
        const code = `
class OuterClass {
    method() {
        function innerFunction() {
            return "nested";
        }
        return innerFunction();
    }
}
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['class_declaration', 'function_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(2);
        expect(nodes[0].type).toBe('class_declaration');
        expect(nodes[1].type).toBe('function_declaration');
        expect(nodes[0].text).toContain('class OuterClass');
        expect(nodes[1].text).toContain('function innerFunction()');
    });

    it('should handle arrow functions', () => {
        const code = `
const arrow1 = () => "hello";
const arrow2 = (x: number) => x * 2;
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['arrow_function']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(2);
        expect(nodes[0].type).toBe('arrow_function');
        expect(nodes[1].type).toBe('arrow_function');
    });

    it('should handle method definitions in classes', () => {
        const code = `
class TestClass {
    method1() {
        return 1;
    }
    
    method2(param: string) {
        return param;
    }
}
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['method_definition']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(2);
        expect(nodes[0].type).toBe('method_definition');
        expect(nodes[1].type).toBe('method_definition');
        expect(nodes[0].text).toContain('method1()');
        expect(nodes[1].text).toContain('method2(param: string)');
    });

    it('should return empty array when no wanted nodes found', () => {
        const code = `
const variable = "hello";
let number = 42;
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['function_declaration', 'class_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(0);
    });

    it('should handle import and export statements', () => {
        const code = `
import { something } from './module';
import * as utils from './utils';

export function exportedFunction() {
    return true;
}

export { something };
        `;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['import_statement', 'export_statement']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes.length).toBeGreaterThan(0);
        expect(nodes.some(node => node.type === 'import_statement')).toBe(true);
        expect(nodes.some(node => node.type === 'export_statement')).toBe(true);
    });

    it('should preserve correct position information', () => {
        const code = `function test() {
    return "hello";
}`;
        
        const tree = parser.parse(code);
        const wantedNodes = new Set(['function_declaration']);
        const nodes = collectTreeNodes(tree.rootNode, wantedNodes);
        
        expect(nodes).toHaveLength(1);
        const node = nodes[0];
        expect(node.startPosition.row).toBe(0); // First line (0-indexed)
        expect(node.startPosition.column).toBe(0); // First column
        expect(node.endPosition.row).toBe(2); // Last line
        expect(node.text).toBe(code);
    });
});