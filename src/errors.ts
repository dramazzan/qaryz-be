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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function getPrismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
}

function isPrismaError(error: unknown) {
  if (!error || typeof error !== "object" || !("name" in error)) {
    return false;
  }

  return typeof error.name === "string" && error.name.startsWith("PrismaClient");
}

function isDatabaseConnectionError(error: unknown) {
  const message = getErrorMessage(error);
  const code = getPrismaErrorCode(error);

  return (
    code === "P1001" ||
    message.includes("Server selection timeout") ||
    message.includes("No available servers") ||
    message.includes("ReplicaSetNoPrimary") ||
    message.includes("received fatal alert")
  );
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

  if (isDatabaseConnectionError(error)) {
    return {
      status: 503,
      message: "База данных временно недоступна. Проверьте DATABASE_URL и доступ MongoDB Atlas для backend-сервера."
    };
  }

  if (isPrismaError(error)) {
    return {
      status: 500,
      message: "Ошибка базы данных"
    };
  }

  return {
    status: 500,
    message: process.env.NODE_ENV === "production" ? "Что-то пошло не так" : getErrorMessage(error) || "Что-то пошло не так"
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
