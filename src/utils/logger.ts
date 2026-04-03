type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  constructor(private readonly level: string) {}

  info(message: string, fields?: Record<string, unknown>): void {
    this.log("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const ordered: LogLevel[] = ["debug", "info", "warn", "error"];
    if (ordered.indexOf(level) < ordered.indexOf(this.level as LogLevel)) {
      return;
    }

    const event = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(fields ?? {})
    };
    console.log(JSON.stringify(event));
  }
}
