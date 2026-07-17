import Anthropic from '@anthropic-ai/sdk';
import {
  AIProviderError,
  type AIProvider,
  type GenerateObjectRequest,
  type GenerateTextRequest,
} from './provider.js';

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 16000;

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(model?: string) {
    // Credentials resolve from the environment (ANTHROPIC_API_KEY or an
    // `ant auth login` profile) — never from appship.yml.
    this.client = new Anthropic();
    this.model = model ?? DEFAULT_MODEL;
  }

  private async createMessage(
    request: GenerateTextRequest,
    outputConfig?: Anthropic.MessageCreateParams['output_config'],
  ): Promise<string> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        ...(outputConfig ? { output_config: outputConfig } : {}),
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new AIProviderError(
          'Anthropic authentication failed. Set ANTHROPIC_API_KEY or run `ant auth login`.',
        );
      }
      if (error instanceof Anthropic.APIError) {
        throw new AIProviderError(`Anthropic API error (${error.status}): ${error.message}`);
      }
      throw error;
    }

    if (response.stop_reason === 'refusal') {
      throw new AIProviderError('The model declined to generate this content.');
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (response.stop_reason === 'max_tokens') {
      throw new AIProviderError('Generation was truncated (max_tokens reached).');
    }
    return text;
  }

  async generateText(request: GenerateTextRequest): Promise<string> {
    return this.createMessage(request);
  }

  async generateObject(request: GenerateObjectRequest): Promise<unknown> {
    const text = await this.createMessage(request, {
      format: { type: 'json_schema', schema: request.jsonSchema },
    });
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AIProviderError(`Model returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }
}
