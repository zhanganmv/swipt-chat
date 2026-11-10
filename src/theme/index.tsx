import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { dark, fontSize, light, type ThemeColors } from "./tokens.ts";

export { fontSize, radius, sidebarMetrics, messageMetrics } from "./tokens.ts";
export type { ThemeColors };

export type TypeStep = keyof typeof fontSize;

export type Theme = {
  scheme: "light" | "dark";
  colors: ThemeColors;
  /** `type("base")` → { fontSize, lineHeight } for a Text style. */
  type: (step: TypeStep) => { fontSize: number; lineHeight: number };
};

const ThemeContext = createContext<Theme | null>(null);

/**
 * Colors and the type scale from `tokens.ts`, switched by the system appearance.
 *
 * Cherry follows the system scheme exactly (no in-app override), so do we.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";

  const value = useMemo<Theme>(
    () => ({
      scheme,
      colors: scheme === "dark" ? dark : light,
      type: (step) => ({
        fontSize: fontSize[step].size,
        lineHeight: fontSize[step].lineHeight,
      }),
    }),
    [scheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}