import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type DefaultTheme } from "vitepress";
import llmstxt from "vitepress-plugin-llms";

/**
 * `ignoreDeadLinks` stays at its default (false — it checks), because a dead
 * link failing the build is the point.
 *
 * Links to PRINCIPLES.md are written as absolute GitHub URLs: that document
 * isn't part of the site. Development records live outside this repository's
 * public docs tree and are not included in the site.
 */

// `pnpm typedoc` writes typedoc-sidebar.json (package.json's build and dev
// scripts run it before vitepress). It isn't a static import because that
// would make tsc require the file to exist, tying `type-check` to whether
// typedoc has run — reading it with fs falls back to an empty array instead.
const here = dirname(fileURLToPath(import.meta.url));
const sidebarPath = resolve(here, "../api/typedoc-sidebar.json");
const typedocSidebar = existsSync(sidebarPath) ? JSON.parse(readFileSync(sidebarPath, "utf8")) : [];

const apiSidebar = [
  {
    text: "API Reference",
    items: [{ text: "The Grammar of Names", link: "/reference/naming" }, ...typedocSidebar],
  },
];

/**
 * The site's sidebar, adjusted for `llms.txt` only.
 *
 * The plugin builds its table of contents by flattening the sidebar with
 * `Object.values(sidebar).flat()` and emitting one `###` section per group. Two
 * things fall out of that which are wrong in a file meant to be read start to
 * finish by an agent, and neither is worth changing the site's navigation over.
 */
function llmsSidebar(configured: DefaultTheme.Sidebar | undefined): DefaultTheme.SidebarItem[] {
  if (!configured) return [];

  // A sidebar is either one flat list or a map of path → list, and each entry
  // of that map is itself either a list or a base-scoped `{ items, base }`
  // wrapper. Unwrapping all three shapes here is what lets the rest of this
  // function work on plain groups.
  const groups: DefaultTheme.SidebarItem[] = [];
  for (const bucket of Array.isArray(configured) ? [configured] : Object.values(configured)) {
    groups.push(...(Array.isArray(bucket) ? bucket : bucket.items));
  }

  /**
   * **The same group, reached by two paths, is still one group.**
   *
   * `apiSidebar` is mounted under both `/reference/` and `/api/` so the API
   * navigation survives wherever the reader is standing. Flattening turns that
   * into the identical object twice, and "API Reference" was printed twice.
   *
   * De-duplicating by object identity rather than by title is deliberate: it
   * removes exactly the one-sidebar-two-mounts case and cannot silently merge
   * two genuinely different groups that happen to share a heading.
   */
  const unique = [...new Set(groups)];

  /**
   * **The gallery index has no sidebar entry**, because in the browser the
   * sidebar itself is the gallery — a link to the list you are looking at is
   * noise. An agent has no sidebar, so the page landed under the plugin's
   * catch-all "Other" heading, detached from the examples it
   * introduces. Putting it at the head of that section restores the order a
   * reader would expect.
   *
   * `/examples/index`, not `/examples/`: the plugin resolves a link to a file
   * by normalizing both sides, and a trailing slash normalizes to `/examples/`
   * while the file normalizes to `/examples` — so the trailing-slash form
   * silently fails to match and the page stays in "Other".
   */
  return unique.map((group) => {
    if (group.text === "Examples") {
      return { ...group, items: [{ text: "All examples", link: "/examples/index" }, ...(group.items ?? [])] };
    }

    /**
     * **Drop the typedoc entries.** `ignoreFiles: ["api/**"]` already keeps them
     * out of the generated files, but the plugin still walks every sidebar item
     * looking for a file to link, and logged 479 "No matching file found"
     * warnings per build for pages it was told to skip. Removing them here means
     * the sidebar handed to the plugin says exactly what the output contains.
     */
    return { ...group, items: (group.items ?? []).filter((item) => !item.link?.startsWith("/api/")) };
  });
}

export default defineConfig({
  title: "@finchart",
  description: "Composable financial charts with a DOM-free core, testable draw commands, and optional browser, React, indicator, and drawing-tool packages",
  lang: "en-US",
  cleanUrls: true,
  outDir: "dist",

  /**
   * `llms.txt`, `llms-full.txt`, and a `.md` twin of every page, regenerated on
   * every build. Nothing here is hand-maintained: the section headings come
   * from the sidebar, and the one-line note after each link comes from that
   * page's `description` frontmatter — which `scripts/llms-txt-check.mjs`
   * requires, so a new page can't land without one.
   *
   * `api/**` is excluded. It is 480 typedoc-generated pages: listing them would
   * bury the eleven guides in `llms.txt`, and bundling them would put megabytes
   * into `llms-full.txt` for content an agent is better off reading from the
   * `.d.ts` anyway. One link to the API reference stands in for all of it.
   *
   * `sidebar` is a **transform, not a replacement** — it receives this config's
   * own sidebar and adjusts it for `llms.txt` alone, so the site's navigation
   * is never bent to suit a generator. Two adjustments, both explained where
   * they happen in `llmsSidebar`.
   */
  vite: {
    plugins: [llmstxt({ ignoreFiles: ["api/**"], sidebar: llmsSidebar })],
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Examples", link: "/examples/" },
      { text: "Showcase", link: "/showcase" },
      { text: "API", link: "/reference/naming" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Custom Indicators", link: "/guide/extensions" },
          ],
        },
        {
          text: "Advanced",
          items: [
            { text: "Drawing Tools", link: "/guide/interaction" },
            { text: "Live Feeds", link: "/guide/live-feed" },
            { text: "Next.js and React apps", link: "/guide/nextjs" },
            { text: "Time zones and sessions", link: "/guide/time-zones" },
            { text: "Testing", link: "/guide/testing" },
            { text: "Workers", link: "/guide/workers" },
            { text: "Reducing Bundle Size", link: "/guide/explicit-wiring" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Theming", link: "/guide/theme" },
            { text: "Plot Contract", link: "/guide/plot-contract" },
            { text: "Glossary", link: "/guide/glossary" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Candles + volume", link: "/examples/candles-volume" },
            { text: "Switching chart types", link: "/examples/chart-types" },
            { text: "Heikin-Ashi", link: "/examples/heikin-ashi" },
            { text: "Price-axis transforms", link: "/examples/price-axis-transforms" },
            { text: "Overlay indicators", link: "/examples/overlays" },
            { text: "Ichimoku", link: "/examples/ichimoku" },
            { text: "Oscillators", link: "/examples/oscillators" },
            { text: "Channels", link: "/examples/channels" },
            { text: "Pivot Points", link: "/examples/pivots" },
            { text: "Volume Profile", link: "/examples/volume-profile" },
            { text: "Own-pane indicators", link: "/examples/own-panes" },
            { text: "Real-time ticks", link: "/examples/realtime" },
            { text: "Infinite history", link: "/examples/infinite-history" },
            { text: "Drawing tools", link: "/examples/drawing" },
            { text: "Bar-index coordinates", link: "/examples/bar-index" },
            { text: "Two synchronized charts", link: "/examples/sync-x" },
            { text: "Custom series", link: "/examples/custom-series" },
            { text: "Session shading", link: "/examples/session-shading" },
            { text: "Worker rendering", link: "/examples/worker-render" },
          ],
        },
      ],
      // The page hides its sidebar; this group keeps llms.txt organized.
      "/showcase": [
        {
          text: "Showcase",
          items: [{ text: "React trading showcase", link: "/showcase" }],
        },
      ],
      "/reference/": apiSidebar,
      "/api/": apiSidebar,
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/FutureSeller/finchart" },
    ],

    search: { provider: "local" },
  },
});
