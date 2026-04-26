import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function getErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.message
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      message: error.issues[0]?.message ?? "Некорректные данные"
    };
  }

  if (error && typeof error === "object" && "name" in error && error.name === "MulterError") {
    return {
      status: 400,
      message: error instanceof Error ? error.message : "Некорректный файл"
    };
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : "Что-то пошло не так"
  };
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const { status, message } = getErrorResponse(error);

  if (status >= 500) {
    console.error(error);
  }

  response.status(status).json({
    error: message
  });
};
