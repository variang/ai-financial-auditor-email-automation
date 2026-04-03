import winston from "winston";

type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  private readonly instance: winston.Logger;

  constructor(level: string) {
    this.instance = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: "email-financial-auditor" },
      transports: [new winston.transports.Console()]
    });
  }

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
    this.instance.log(level, message, fields ?? {});
  }
}
