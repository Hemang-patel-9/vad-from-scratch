import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export -> `out/`, served by FastAPI so both run on one port.
  output: "export",
  // Emits `out/energy-based/index.html` instead of `out/energy-based.html`.
  // Starlette's StaticFiles resolves a directory to its index; it will not map
  // an extensionless path onto a sibling `.html` file.
  trailingSlash: true,
};

export default nextConfig;
