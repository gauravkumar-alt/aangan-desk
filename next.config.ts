import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The rules loader reads case/*.md at runtime; make sure they ship with the server bundle.
  outputFileTracingIncludes: { "/**": ["./case/**/*.md"] },
};

export default nextConfig;
