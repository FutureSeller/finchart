# Chart Library Development Principles

## Process (TDD)

1. **Interface first** — define the interface or class before anything else
2. **Test first** — write the test before the implementation (TDD)
3. **Implementation last** — write only what satisfies the test

## Design

4. **Canvas is the only renderer** — data is drawn to canvas only. The SVG
   backend was removed (2026-07-30). That said, **a series doesn't know what
   surface it's drawing to** — it only ever receives a `DrawTarget`, so on the
   day another surface gets attached, the series are unchanged. **The real
   output isn't pixels, it's the command list** — keep it as pure data and
   other surfaces, other threads, and test assertions all fall out of it
5. **Core is framework-agnostic** — no React or Vue dependency in the
   TypeScript core
6. **Start small** — one chart type first, features added incrementally.
   **What widens is features, not the contract** (→ 9)
7. **Split the renderer from the logic** — calculations are pure functions,
   drawing is commands
8. **No over-engineering (YAGNI)** — if you don't need it now, don't build it.
   **This applies to implementations**
9. **Contracts are YAGNI's exception** — anywhere adding it later would be
   breaking, dig the hole now. Implementations can and should wait, but
   **punching a hole in a type cannot.** The test isn't "do I need this now"
   but **"does doing it later break someone else's code"**. In that spot, put
   the optional field and no implementation
10. **Require only as much as you use** — a contract carries only what it
    consumes. The grid requires exactly one `drawLine` (`GridTarget`), a
    series requires three `DrawTarget` methods. Accept something wide and you
    can never change it. **Extensions are the same** — a plugin asks, in its
    types, only for the capabilities it uses, and **there is no monolithic
    "the one door an extension sees" type.** Once that exists, every new
    extension piles another field onto it
11. **Collaborators are injected from outside** — scale, data, layers,
    renderer, scheduler, and style reader all arrive through `PlotDeps`.
    Policy stays a wiring question rather than a code question. **And if you
    don't inject it, it doesn't happen** — there are no do-nothing
    implementations (null objects). That isn't a way to turn something off,
    it's code that stays in the bundle
12. **Extensions come wrapped** — one extension **installs with one function
    and uninstalls with one function** (`plot.use(crosshair())`). Users are
    not left to hand-assemble and hand-dismantle a series plus a decoration
    plus a computation plus a subscription plus options. **`use` returns the
    object the plugin made, as-is** — it doesn't merge methods onto the
    instance, so a plugin never changes the `Plot` type
13. **No global registry** — extensions are imported and attached. A global
    registry can never be removed once it exists: tree-shaking dies (unused
    indicators enter the bundle) and tests acquire state

## Quality

14. **Measurement is built in** — metrics are collectable from day one
15. **Split by surface** — data goes to canvas; axis labels, annotations, and
    tooltips go to a DOM overlay. **Which side text belongs on is decided by
    count and frequency** — a fixed, long-lived set like axis labels goes to
    the DOM; anything whose position changes every frame and whose count
    scales with the data, like markers and price labels, goes to canvas. In
    the DOM that would be hundreds of nodes. **Stacking order (z) and update
    frequency are different axes** — one slot never serves both
16. **Explicit error handling** — use `throw` (clear and concise).
    **The boundary is different, though** — one bad data point from a consumer
    must not kill their app. Internal invariants throw; values arriving from
    outside get demoted to whitespace, or the policy comes in as an option
17. **Types should be facts** — a type erased by a cast usually exists. Before
    papering over it with `as`, look for where that type can be pinned down
18. **Anything public is a contract** — the moment you `export` it, assume it
    has consumers. Export internals and every refactor becomes breaking.
    **Export by name only what extensions need**; leave the rest on a subpath
    or keep it private

## Architecture

19. **Core (imperative)** — the `Plot` class, `applyOptions`, automatic
    interactions. **A series owns its data** — `Plot` doesn't know the point
    type
20. **React wrapper (declarative)** — hooks and state drive the core
21. **Interactions are automatic** — pan, zoom, and crosshair are **defaults**
    (nothing for the user to implement). Defaults, not mandates. **"Leave it
    out of the wiring and the code doesn't ship" is the promise explicit
    wiring makes** (→ 11, 27) — a preset (`browserDeps`) pulls in everything
    it references, regardless of options. Bundlers look at "is it referenced",
    not "does it run", so a runtime flag (`pointer: false`) is a door for
    behavior, not for bytes (measured: flipping the flag produces a
    byte-identical bundle — the absolute numbers move every time you
    re-measure, but that conclusion doesn't).
    **Corollary**: *default wiring* for convenience is banned for the same
    reason — make `deps` optional and the wrapper statically imports
    `browserDeps`, and from that moment consumers who wired leanly, plus
    headless and worker builds, all carry the browser shell (single-
    digit to double-digit KB — re-measure for the exact figure). **If a
    default causes a static import in the package, it isn't a default, it's a
    charge levied on every consumer.** Lower the barrier to entry with docs
    instead
22. **State is synchronous, drawing is per-frame** — methods that change state
    take effect immediately and the render is scheduled. Requests within one
    frame collapse into one

## Optimization

23. **Measure first, optimize second** — profile instead of guessing. Record
    the post-fix numbers alongside the ADR.
    **To reopen something you measured and shelved, measure again** — an old
    ADR's numbers are a valid baseline until re-measured. "It feels different
    this time" is not evidence

## Docs & examples

24. **Record the why** — architectural decisions and their reasons
25. **Prove it with the examples app** — a new feature is committed only after
    it actually works in `apps/examples`.
    **Extension points too** — if not a single implementation has ever been
    swapped in, that extension point doesn't really exist
26. **Document trade-offs** — the reasoning behind performance-vs-features
    calls

## Bundle

27. **Every passenger has a door or a justification** — for each thing that
    ships in the bundle without the consumer using it, there must be either a
    **real door at import granularity** (it drops out of explicit wiring) or a
    **written justification in the contract** (why it's part of core).
    **"It's small" can't be the reason** — size is unarguable, but a written
    justification becomes arguable the moment it's written down, and the day
    it collapses we dig the door. Current doorless passengers and their
    justifications: decimation on by default (a performance contract — the moment a
    derived series attaches, 100k points is where the expectation sits) and
    axis-drag (an input contract — headless `routeInput` is first-class).

---

Keep the principles short. Consumer guides and the API reference live in
`apps/docs/` (the public docs site). Current implementation and contributor
guidance live in [docs/](docs/README.md). Historical design decisions and ADRs
remain in internal documents outside this repository; the public documentation
must carry enough explanation to stand on its own.
**When this conflicts with the plan, the plan wins.**
