import TSLang from "tree-sitter-typescript";
import { ChunkConfig } from "./types";

const tsConfig = {
    language: TSLang.typescript,
    name: "typescript",
    wantedNodes: new Set<string>([
        // High-level constructs for meaningful chunks
        'function_declaration',
        'method_definition', 
        'class_declaration',
        'interface_declaration',
        'type_alias_declaration',
        'enum_declaration',
        'namespace_declaration',
        'module_declaration',
        // Variable declarations for constants and exports
        'variable_declaration',
        'lexical_declaration',
        // Import/export statements
        'import_statement',
        'export_statement'
    ])

}


const tsxConfig: ChunkConfig = {
    language: TSLang.tsx,
    name: tsConfig.name,
    wantedNodes: tsConfig.wantedNodes
}

export const LANG_CONFIG: Record<string, ChunkConfig> = {
    '.ts': tsConfig,
    '.tsx': tsxConfig
}