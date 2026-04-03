export interface LlmGenerateInput {
  instruction: string;
  context: Record<string, unknown>;
}

export interface LlmGenerateOutput {
  text: string;
}

export interface LlmClient {
  generate(input: LlmGenerateInput): Promise<LlmGenerateOutput>;
}

export class StubLlmClient implements LlmClient {
  async generate(input: LlmGenerateInput): Promise<LlmGenerateOutput> {
    return {
      text: `Stub response for instruction: ${input.instruction}`
    };
  }
}
