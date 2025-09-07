/**
 * Tokenizer utilities using tiktoken for accurate token counting
 */

import { get_encoding } from 'tiktoken';
import { TokenProcessingError } from './errors';

/**
 * Supported OpenAI models for tokenization
 */
export const SUPPORTED_MODELS = {
  'text-embedding-3-large': 'cl100k_base',
  'text-embedding-3-small': 'cl100k_base',
  'text-embedding-ada-002': 'cl100k_base',
  'gpt-4': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base'
} as const;

export type SupportedModel = keyof typeof SUPPORTED_MODELS;

/**
 * Tokenizer wrapper for consistent token counting
 */
export class Tokenizer {
  private encoding: any;
  private modelName: string;

  constructor(modelName: string = 'text-embedding-3-large') {
    this.modelName = modelName;
    
    try {
      const encodingName = SUPPORTED_MODELS[modelName as SupportedModel] || 'cl100k_base';
      this.encoding = get_encoding(encodingName);
    } catch (error) {
      throw new TokenProcessingError(
        `Failed to initialize tokenizer for model ${modelName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Count tokens in a text string
   */
  countTokens(text: string): number {
    try {
      if (!text || text.trim().length === 0) {
        return 0;
      }
      
      const tokens = this.encoding.encode(text);
      return tokens.length;
    } catch (error) {
      throw new TokenProcessingError(
        `Failed to count tokens: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if text exceeds token limit
   */
  exceedsLimit(text: string, maxTokens: number): boolean {
    return this.countTokens(text) > maxTokens;
  }

  /**
   * Get the model name used by this tokenizer
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.encoding && typeof this.encoding.free === 'function') {
      this.encoding.free();
    }
  }
}

/**
 * Create a tokenizer instance for a specific model
 */
export function createTokenizer(modelName: string = 'text-embedding-3-large'): Tokenizer {
  return new Tokenizer(modelName);
}

/**
 * Utility function to count tokens without creating a persistent tokenizer
 */
export function countTokens(text: string, modelName: string = 'text-embedding-3-large'): number {
  const tokenizer = createTokenizer(modelName);
  try {
    return tokenizer.countTokens(text);
  } finally {
    tokenizer.dispose();
  }
}