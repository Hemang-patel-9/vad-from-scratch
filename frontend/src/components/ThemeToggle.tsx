"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "theme";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (event: MediaQueryListEvent) => {
      if (localStorage.getItem(THEME_KEY)) return;
      setTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Safari in private mode throws on write. The toggle still works, it
      // just forgets between visits, which beats taking the page down.
    }
  }, [theme]);

  const Icon = theme === "dark" ? Moon : Sun;

  return (
    <motion.button
      type="button"
      onClick={toggle}
      suppressHydrationWarning
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className={`relative grid size-8 place-items-center overflow-hidden rounded-md border border-line text-muted transition-colors hover:bg-surface hover:text-foreground ${className}`}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={theme}
          initial={{ y: 10, opacity: 0, rotate: -30 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -10, opacity: 0, rotate: 30 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="grid place-items-center"
        >
          <Icon className="size-4" aria-hidden />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
