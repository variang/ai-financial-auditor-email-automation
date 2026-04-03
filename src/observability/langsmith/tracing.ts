import { Client } from "langsmith";

export interface TracingAdapter {
  withTrace<T>(runName: string, fn: () => Promise<T>): Promise<T>;
}

export class NoopTracingAdapter implements TracingAdapter {
  async withTrace<T>(_runName: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export class LangSmithTracingAdapter implements TracingAdapter {
  private readonly client: Client;

  constructor(apiKey: string | undefined, private readonly project: string) {
    this.client = new Client({ apiKey });
  }

  async withTrace<T>(runName: string, fn: () => Promise<T>): Promise<T> {
    // The Client instance confirms SDK wiring; full run-tree instrumentation is added later.
    void this.client;
    const result = await fn();
    console.log(
      JSON.stringify({ type: "langsmith-trace", project: this.project, runName })
    );
    return result;
  }
}
