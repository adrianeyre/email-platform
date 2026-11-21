export type JsonRecord = Record<string, unknown>;

export interface FieldProblem {
  field: string;
  message: string;
}

export class ApiRequestFailedError extends Error {
  override name = "ApiRequestFailedError";

  constructor(
    readonly status: number,
    message: string,
    readonly fieldProblems: readonly FieldProblem[],
  ) {
    super(message);
  }
}

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readProperty = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

export const readText = (value: unknown, key: string): string => {
  const property = readProperty(value, key);
  if (typeof property === "string") {
    return property;
  }
  if (typeof property === "number" || typeof property === "boolean") {
    return property.toString();
  }
  return "";
};

export const readNumber = (value: unknown, key: string): number | undefined => {
  const property = readProperty(value, key);
  return typeof property === "number" ? property : undefined;
};

export const readFlag = (value: unknown, key: string): boolean =>
  readProperty(value, key) === true;

export const readRecord = (value: unknown, key: string): JsonRecord => {
  const property = readProperty(value, key);
  return isRecord(property) ? property : {};
};

export const readRecords = (value: unknown, key: string): JsonRecord[] => {
  const property = readProperty(value, key);
  return Array.isArray(property) ? property.filter(isRecord) : [];
};

/** Who made a User or API Key, as the Users and API keys pages show it (pen test A2, #125). */
export const readCreator = (value: unknown): string => {
  const email = readText(value, "createdByEmail");
  if (email !== "") {
    return email;
  }
  return readText(value, "createdByUserId") === ""
    ? "The CLI, or before this was recorded"
    : "A deleted user";
};

export const readTexts = (value: unknown, key: string): string[] => {
  const property = readProperty(value, key);
  return Array.isArray(property)
    ? property.filter((item): item is string => typeof item === "string")
    : [];
};

const readFieldProblems = (body: unknown): FieldProblem[] =>
  readRecords(body, "errors").map((problem) => ({
    field: readText(problem, "field"),
    message: readText(problem, "message"),
  }));

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { message: text };
  }
};

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export const requestJson = async (
  path: string,
  options: RequestOptions = {},
): Promise<unknown> => {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers:
      options.body === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw new ApiRequestFailedError(
      response.status,
      readText(body, "message") ||
        `The request failed (${String(response.status)})`,
      readFieldProblems(body),
    );
  }
  return body;
};

export const describeFailure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
