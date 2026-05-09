import type { Logger } from "../../utils/logger.js";
import type { AppConfig } from "../../config/env.js";

export interface LlmResponseSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmGenerateInput {
  instruction: string;
  context: Record<string, unknown>;
  responseSchema?: LlmResponseSchema;
}

export interface LlmGenerateOutput {
  text: string;
}

export interface LlmClient {
  generate(input: LlmGenerateInput): Promise<LlmGenerateOutput>;
}

export class StubLlmClient implements LlmClient {
  async generate(input: LlmGenerateInput): Promise<LlmGenerateOutput> {
    if (input.instruction.includes("Extract all transactions")) {
      return {
        text: JSON.stringify({ transactions: [], parseErrors: [] })
      };
    }
    return {
      text: `Stub response for instruction: ${input.instruction}`
    };
  }
}

export class OpenAiLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.model = config.llmModel;

    if (config.azureOpenaiApiKey && config.azureOpenaiEndpoint) {
      this.apiKey = config.azureOpenaiApiKey;
      this.endpoint = config.azureOpenaiEndpoint;
    } else if (config.openaiApiKey) {
      this.apiKey = config.openaiApiKey;
      this.endpoint = "https://api.openai.com/v1";
    } else {
      throw new Error(
        "CopilotLlmClient requires either AZURE_OPENAI_API_KEY+AZURE_OPENAI_ENDPOINT or OPENAI_API_KEY"
      );
    }
  }

  async generate(input: LlmGenerateInput): Promise<LlmGenerateOutput> {
    try {
      const messages = [
        {
          role: "system",
          content: "You are a financial statement parser. Respond with valid JSON only."
        },
        {
          role: "user",
          content: `${input.instruction}\n\nContext:\n${JSON.stringify(input.context, null, 2)}`
        }
      ];

      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        temperature: 0.2,
        max_tokens: 2000
      };

      if (input.responseSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: input.responseSchema.name,
            strict: true,
            schema: input.responseSchema.schema
          }
        };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (this.endpoint.includes("openai.azure.com")) {
        headers["api-key"] = this.apiKey;
      } else {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const url = this.endpoint.includes("openai.azure.com")
        ? `${this.endpoint}/openai/deployments/${this.model}/chat/completions?api-version=2024-02-15-preview`
        : `${this.endpoint}/chat/completions`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LLM API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        choices: Array<{
          message: {
            content: string;
          };
        }>;
      };

      const text = data.choices[0]?.message?.content || "";
      this.logger.info("llm-generate-success", {
        instruction: input.instruction.substring(0, 50),
        textLength: text.length
      });

      return { text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("llm-generate-failed", { message });
      throw error;
    }
  }
}

