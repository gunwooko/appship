// AI provider abstraction (TRD §5.2). Providers only turn facts into prose —
// facts themselves come from the deterministic scanner (Principle 1).

export interface GenerateTextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface GenerateObjectRequest extends GenerateTextRequest {
  /** JSON Schema (objects must set additionalProperties: false). */
  jsonSchema: Record<string, unknown>;
}

export interface AIProvider {
  readonly name: string;
  generateText(request: GenerateTextRequest): Promise<string>;
  /** Returns the parsed JSON object; the caller validates it (e.g. with zod). */
  generateObject(request: GenerateObjectRequest): Promise<unknown>;
}

export class AIProviderError extends Error {}
