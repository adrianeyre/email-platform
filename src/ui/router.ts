export type RouteName =
  | "templates"
  | "newTemplate"
  | "template"
  | "headers"
  | "newHeader"
  | "header"
  | "footers"
  | "newFooter"
  | "footer"
  | "configurations"
  | "newConfiguration"
  | "configuration"
  | "logs"
  | "message"
  | "apiKeys"
  | "users"
  | "delivery"
  | "settings"
  | "notFound";

export interface RouteMatch {
  name: RouteName;
  params: Record<string, string>;
}

const routePatterns: readonly (readonly [RouteName, string])[] = [
  ["templates", "/"],
  ["templates", "/templates"],
  ["newTemplate", "/templates/new"],
  ["template", "/templates/:templateId"],
  ["headers", "/headers"],
  ["newHeader", "/headers/new"],
  ["header", "/headers/:partId"],
  ["footers", "/footers"],
  ["newFooter", "/footers/new"],
  ["footer", "/footers/:partId"],
  ["configurations", "/configurations"],
  ["newConfiguration", "/configurations/new"],
  ["configuration", "/configurations/:configurationId"],
  ["logs", "/logs"],
  ["message", "/logs/:messageId"],
  ["apiKeys", "/api-keys"],
  ["users", "/users"],
  ["delivery", "/delivery"],
  ["settings", "/settings"],
];

const splitPath = (path: string): string[] =>
  path.split("/").filter((segment) => segment !== "");

const matchPattern = (
  pattern: string,
  pathname: string,
): Record<string, string> | undefined => {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  if (patternSegments.length !== pathSegments.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [index, patternSegment] of patternSegments.entries()) {
    const pathSegment = pathSegments[index] ?? "";
    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (patternSegment !== pathSegment) {
      return undefined;
    }
  }
  return params;
};

export const matchRoute = (pathname: string): RouteMatch => {
  for (const [name, pattern] of routePatterns) {
    const params = matchPattern(pattern, pathname);
    if (params !== undefined) {
      return { name, params };
    }
  }
  return { name: "notFound", params: {} };
};

const navigationEvent = "app:navigate";

export const navigateTo = (href: string): void => {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(navigationEvent));
};

export const subscribeToNavigation = (onChange: () => void): (() => void) => {
  window.addEventListener("popstate", onChange);
  window.addEventListener(navigationEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(navigationEvent, onChange);
  };
};
