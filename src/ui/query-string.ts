export type QueryValues = Readonly<
  Record<string, string | number | boolean | undefined>
>;

export const buildQueryString = (values: QueryValues): string => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === "") {
      continue;
    }
    params.set(name, typeof value === "string" ? value.trim() : String(value));
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
};

export const toIsoDateTime = (localDateTime: string): string | undefined => {
  if (localDateTime === "") {
    return undefined;
  }
  const parsed = new Date(localDateTime);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};
