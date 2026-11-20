/**
 * A Template's slug: the short, stable handle an application sends it by, such as `order-shipped`. Shared by the
 * server and the UI, so both apply the same rule.
 */

export const maxSlugLength = 100;

/** Only lowercase letters, numbers and hyphens: no spaces and no capitals. */
export const slugPattern = /^[a-z0-9-]+$/u;

export const slugRule = "Lowercase letters, numbers and hyphens";

const fallbackSlug = "template";

const trimHyphens = (value: string) => value.replace(/^-+|-+$/gu, "");

/**
 * Turns a name into a slug: accents dropped, lowercase, every run of other characters becomes one hyphen, and no
 * hyphen at either end. A name with no letters or numbers gives "template".
 */
export const slugify = (name: string): string => {
  const slug = trimHyphens(
    trimHyphens(
      name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-"),
    ).slice(0, maxSlugLength),
  );
  return slug === "" ? fallbackSlug : slug;
};

/** The problem with a slug, or undefined when it follows the rule. */
export const findSlugProblem = (slug: string): string | undefined => {
  if (slug === "") {
    return "Enter a slug";
  }
  if (slug.length > maxSlugLength) {
    return `The slug must be ${String(maxSlugLength)} characters or fewer`;
  }
  if (!slugPattern.test(slug)) {
    return `The slug may only use lowercase letters, numbers and hyphens (a-z, 0-9 and -), with no spaces, such as ${slugify(slug)}`;
  }
  return undefined;
};

export const isValidSlug = (slug: string): boolean =>
  findSlugProblem(slug) === undefined;

/** The slug with a number on the end, such as order-shipped-2, still within the length limit. */
export const numberedSlug = (slug: string, number: number): string => {
  const suffix = `-${String(number)}`;
  return `${trimHyphens(slug.slice(0, maxSlugLength - suffix.length))}${suffix}`;
};

/** The slug itself when it is free, otherwise the first numbered one (-2, -3…) that is. */
export const firstFreeSlug = (
  slug: string,
  isTaken: (candidate: string) => boolean,
): string => {
  let candidate = slug;
  for (let number = 2; isTaken(candidate); number += 1) {
    candidate = numberedSlug(slug, number);
  }
  return candidate;
};
