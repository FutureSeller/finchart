---
"@finchart/react": patch
---

The bundle begins with `"use client"`. The package creates a React context at module scope, which only a client module may do, and imported from a server file (Next.js App Router's default) it failed with "createContext only works in Client Components". The directive marks the boundary, so that import no longer fails at the module; a chart still needs a Client Component of your own around it, because `deps={browserDeps()}` is a function and cannot cross the boundary as a prop. The build asserts the banner is there.
