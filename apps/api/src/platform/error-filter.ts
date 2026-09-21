import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { ZodError } from "zod";
@Catch()
export class PlatformErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : 503;
    const message =
      error instanceof ZodError
        ? "Invalid request."
        : error instanceof HttpException
          ? error.message
          : "Service is temporarily unavailable.";
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        type: "error",
        error: {
          type:
            status === 401
              ? "authentication_error"
              : status === 429
                ? "rate_limit_error"
                : "api_error",
          message,
        },
      }),
    );
  }
}
