import { describe, it, expect, beforeEach } from 'vitest';
import Parser from 'tree-sitter';
import TSLang from 'tree-sitter-typescript';
import { extractSymbolName, extractSymbolType, collectTreeNodesWithSymbols } from './chunk-file';

describe('Symbol Extraction', () => {
    let parser: Parser;
    
    beforeEach(() => {
        parser = new Parser();
        parser.setLanguage(TSLang.typescript);
    });

    describe('extractSymbolName', () => {
        it('should extract function names', () => {
            const code = 'function myFunction() { return true; }';
            const tree = parser.parse(code);
            const functionNode = tree.rootNode.children.find(child => child.type === 'function_declaration');
            
            expect(functionNode).toBeDefined();
            const symbolName = extractSymbolName(functionNode!);
            expect(symbolName).toBe('myFunction');
        });

        it('should extract class names', () => {
            const code = 'class MyClass { }';
            const tree = parser.parse(code);
            const classNode = tree.rootNode.children.find(child => child.type === 'class_declaration');
            
            expect(classNode).toBeDefined();
            const symbolName = extractSymbolName(classNode!);
            expect(symbolName).toBe('MyClass');
        });

        it('should extract interface names', () => {
            const code = 'interface MyInterface { name: string; }';
            const tree = parser.parse(code);
            const interfaceNode = tree.rootNode.children.find(child => child.type === 'interface_declaration');
            
            expect(interfaceNode).toBeDefined();
            const symbolName = extractSymbolName(interfaceNode!);
            expect(symbolName).toBe('MyInterface');
        });

        it('should extract type alias names', () => {
            const code = 'type MyType = string | number;';
            const tree = parser.parse(code);
            const typeNode = tree.rootNode.children.find(child => child.type === 'type_alias_declaration');
            
            expect(typeNode).toBeDefined();
            const symbolName = extractSymbolName(typeNode!);
            expect(symbolName).toBe('MyType');
        });

        it('should extract method names from classes', () => {
            const code = `
class TestClass {
    myMethod() {
        return true;
    }
}`;
            const tree = parser.parse(code);
            const classNode = tree.rootNode.children.find(child => child.type === 'class_declaration');
            const methodNode = classNode?.children.find(child => child.type === 'class_body')
                ?.children.find(child => child.type === 'method_definition');
            
            expect(methodNode).toBeDefined();
            const symbolName = extractSymbolName(methodNode!);
            expect(symbolName).toBe('myMethod');
        });

        it('should handle anonymous arrow functions', () => {
            const code = 'const func = () => true;';
            const tree = parser.parse(code);
            // Find the arrow function node
            const findArrowFunction = (node: any): any => {
                if (node.type === 'arrow_function') return node;
                for (const child of node.children) {
                    const result = findArrowFunction(child);
                    if (result) return result;
                }
                return null;
            };
            
            const arrowNode = findArrowFunction(tree.rootNode);
            expect(arrowNode).toBeDefined();
            const symbolName = extractSymbolName(arrowNode);
            expect(symbolName).toBeUndefined(); // Anonymous functions don't have names
        });

        it('should extract variable names', () => {
            const code = 'const myVariable = 42;';
            const tree = parser.parse(code);
            const varNode = tree.rootNode.children.find(child => child.type === 'lexical_declaration');
            
            expect(varNode).toBeDefined();
            const symbolName = extractSymbolName(varNode!);
            expect(symbolName).toBe('myVariable');
        });

        it('should handle export statements with functions', () => {
            const code = 'export function exportedFunction() { return true; }';
            const tree = parser.parse(code);
            const exportNode = tree.rootNode.children.find(child => child.type === 'export_statement');
            
            expect(exportNode).toBeDefined();
            const symbolName = extractSymbolName(exportNode!);
            expect(symbolName).toBe('exportedFunction');
        });

        it('should handle import statements', () => {
            const code = 'import { myImport } from "./module";';
            const tree = parser.parse(code);
            const importNode = tree.rootNode.children.find(child => child.type === 'import_statement');
            
            expect(importNode).toBeDefined();
            const symbolName = extractSymbolName(importNode!);
            expect(symbolName).toBe('myImport');
        });

        it('should handle default imports', () => {
            const code = 'import defaultImport from "./module";';
            const tree = parser.parse(code);
            const importNode = tree.rootNode.children.find(child => child.type === 'import_statement');
            
            expect(importNode).toBeDefined();
            const symbolName = extractSymbolName(importNode!);
            expect(symbolName).toBe('defaultImport');
        });
    });

    describe('extractSymbolType', () => {
        it('should return correct symbol types', () => {
            const testCases = [
                { code: 'function test() {}', nodeType: 'function_declaration', expectedType: 'function' },
                { code: 'class Test {}', nodeType: 'class_declaration', expectedType: 'class' },
                { code: 'interface Test {}', nodeType: 'interface_declaration', expectedType: 'interface' },
                { code: 'type Test = string;', nodeType: 'type_alias_declaration', expectedType: 'type_alias' },
                { code: 'const x = 1;', nodeType: 'lexical_declaration', expectedType: 'variable' },
            ];

            testCases.forEach(({ code, nodeType, expectedType }) => {
                const tree = parser.parse(code);
                const node = tree.rootNode.children.find(child => child.type === nodeType);
                expect(node).toBeDefined();
                const symbolType = extractSymbolType(node!);
                expect(symbolType).toBe(expectedType);
            });
        });
    });

    describe('collectTreeNodesWithSymbols', () => {
        it('should collect nodes with symbol information', () => {
            const code = `
function myFunction() {
    return "hello";
}

class MyClass {
    myMethod() {
        return true;
    }
}

interface MyInterface {
    name: string;
}
            `;
            
            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration', 'class_declaration', 'interface_declaration', 'method_definition']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            
            expect(nodes).toHaveLength(4);
            
            // Check function
            const functionNode = nodes.find(n => n.type === 'function_declaration');
            expect(functionNode).toBeDefined();
            expect(functionNode!.symbolName).toBe('myFunction');
            expect(functionNode!.symbolType).toBe('function');
            
            // Check class
            const classNode = nodes.find(n => n.type === 'class_declaration');
            expect(classNode).toBeDefined();
            expect(classNode!.symbolName).toBe('MyClass');
            expect(classNode!.symbolType).toBe('class');
            
            // Check interface
            const interfaceNode = nodes.find(n => n.type === 'interface_declaration');
            expect(interfaceNode).toBeDefined();
            expect(interfaceNode!.symbolName).toBe('MyInterface');
            expect(interfaceNode!.symbolType).toBe('interface');
            
            // Check method
            const methodNode = nodes.find(n => n.type === 'method_definition');
            expect(methodNode).toBeDefined();
            expect(methodNode!.symbolName).toBe('myMethod');
            expect(methodNode!.symbolType).toBe('method');
        });

        it('should handle edge cases with anonymous functions', () => {
            const code = `
const anonymousArrow = () => "hello";
const namedFunction = function() { return "world"; };
            `;
            
            const tree = parser.parse(code);
            const wantedNodes = new Set(['arrow_function', 'function', 'lexical_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            
            // Should find variable declarations and functions
            expect(nodes.length).toBeGreaterThan(0);
            
            const varNodes = nodes.filter(n => n.type === 'lexical_declaration');
            expect(varNodes.length).toBe(2);
            expect(varNodes[0].symbolName).toBe('anonymousArrow');
            expect(varNodes[1].symbolName).toBe('namedFunction');
        });

        it('should maintain sorting by line number', () => {
            const code = `
interface Third { }

function first() { }

class Second { }
            `;
            
            const tree = parser.parse(code);
            const wantedNodes = new Set(['function_declaration', 'class_declaration', 'interface_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            
            expect(nodes).toHaveLength(3);
            // Should be sorted by line number
            expect(nodes[0].symbolName).toBe('Third');
            expect(nodes[1].symbolName).toBe('first');
            expect(nodes[2].symbolName).toBe('Second');
        });

        it('should handle complex nested structures', () => {
            const code = `
export class OuterClass {
    innerMethod() {
        function nestedFunction() {
            return "nested";
        }
        return nestedFunction();
    }
}
            `;
            
            const tree = parser.parse(code);
            const wantedNodes = new Set(['export_statement', 'class_declaration', 'method_definition', 'function_declaration']);
            const nodes = collectTreeNodesWithSymbols(tree.rootNode, wantedNodes);
            
            expect(nodes.length).toBeGreaterThan(0);
            
            const exportNode = nodes.find(n => n.type === 'export_statement');
            const classNode = nodes.find(n => n.type === 'class_declaration');
            const methodNode = nodes.find(n => n.type === 'method_definition');
            const functionNode = nodes.find(n => n.type === 'function_declaration');
            
            expect(exportNode).toBeDefined();
            expect(classNode).toBeDefined();
            expect(classNode!.symbolName).toBe('OuterClass');
            expect(methodNode).toBeDefined();
            expect(methodNode!.symbolName).toBe('innerMethod');
            expect(functionNode).toBeDefined();
            expect(functionNode!.symbolName).toBe('nestedFunction');
        });
    });
});