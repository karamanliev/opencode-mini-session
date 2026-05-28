const FALLBACK_ERROR_MESSAGE = "The side question failed.";
const NESTED_ERROR_KEYS = ["error", "cause", "details"] as const;

export function extractErrorMessage(error: unknown) {
  const message = readErrorMessage(error);
  if (message) return message;
  return FALLBACK_ERROR_MESSAGE;
}

export function getErrorMessage(cause: unknown) {
  const extracted = extractErrorMessage(cause);
  if (cause instanceof Error && cause.message) {
    const normalizedMessage = normalizeErrorText(cause.message);
    if (normalizedMessage && !isGenericErrorLabel(normalizedMessage)) {
      return normalizedMessage;
    }
  }
  if (extracted) return extracted;
  if (cause instanceof Error && cause.name) return cause.name;
  return FALLBACK_ERROR_MESSAGE;
}

function readErrorMessage(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || !error) return undefined;
  if (typeof error === "string") return normalizeErrorText(error);
  if (Array.isArray(error)) {
    for (const item of error) {
      const message = readErrorMessage(item, depth + 1);
      if (message) return message;
    }
    return undefined;
  }
  if (!isRecord(error)) return undefined;

  const dataMessage = readDataMessage(error);
  if (dataMessage) return dataMessage;

  for (const key of NESTED_ERROR_KEYS) {
    const message = readErrorMessage(error[key], depth + 1);
    if (message) return message;
  }

  const directMessage = normalizeErrorText(error.message);
  if (directMessage && !isGenericErrorLabel(directMessage)) return directMessage;

  const name = normalizeErrorText(error.name);
  if (name) return name;

  return undefined;
}

function readDataMessage(error: Record<string, unknown>) {
  const data = error.data;
  if (!isRecord(data)) return undefined;
  return normalizeErrorText(data.message);
}

const MAX_ERROR_TEXT_LENGTH = 4000;

function normalizeErrorText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_ERROR_TEXT_LENGTH
    ? `${trimmed.slice(0, MAX_ERROR_TEXT_LENGTH - 3)}...`
    : trimmed;
}

function isGenericErrorLabel(value: string) {
  return /^(unknown(error)?|error)$/i.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
