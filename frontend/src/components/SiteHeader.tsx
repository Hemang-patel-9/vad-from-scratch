"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Waves } from "lucide-react";

import { ThemeToggle } from "@/components/ThemeToggle";

const LINKS = [
  { href: "/energy-based", label: "Energy" },
  { href: "/zero-crossing", label: "Zero-crossing" },
  { href: "/spectral", label: "Spectral" },
  { href: "/dl-based", label: "Neural" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const here = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted transition-colors hover:text-foreground"
        >
          <Waves className="size-4" aria-hidden />
          <span className="hidden sm:inline">VAD from scratch</span>
          <span className="sm:hidden">VAD</span>
        </Link>

        <nav
          aria-label="Detectors"
          className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {LINKS.map((link) => {
            const active = here === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative shrink-0 rounded-md px-2.5 py-1.5 font-mono text-xs transition-colors ${
                  active ? "text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 -z-10 rounded-md bg-surface ring-1 ring-line"
                  />
                )}
                {link.label}
              </Link>
            );
          })}
        </nav>

        <ThemeToggle className="shrink-0" />
      </div>
    </header>
  );
}
