import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export -> `out/`, served by FastAPI so both run on one port.
  output: "export",
};

export default nextConfig;
