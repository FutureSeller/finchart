import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@finchart/core", "@finchart/dom", "@finchart/indicators", "@finchart/react", "@finchart/tools"],
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
};

export default nextConfig;
