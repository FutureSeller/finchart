import { defineConfig } from "tsdown";

/**
 * `"use client"` on the bundle. The package creates a React context at
 * module scope, which only a client module may do — imported from a Server
 * Component (Next.js App Router's default) the build failed with
 * "createContext only works in Client Components". The directive marks the
 * boundary, so that import no longer fails at the module; a chart still
 * needs a Client Component around it, because `deps` is a function and
 * cannot cross the boundary as a prop. SSR is fine: module evaluation
 * touches no DOM, and `renderToString` of a container works in Node.
 */
export default defineConfig({
  banner: '"use client";',
});
