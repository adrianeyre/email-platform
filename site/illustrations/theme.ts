import { useSyncExternalStore } from "react";

const query = "(prefers-color-scheme: dark)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
};

/** The visitor's colour scheme, followed live, so a stage switches with the page. */
export const useTheme = (): "light" | "dark" =>
  useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(query).matches ? "dark" : "light"),
    () => "light",
  );
