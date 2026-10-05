# Developer documentation

This directory explains how to develop and maintain the repository. It describes
the current implementation and the contracts a change must preserve.

## Reading order

| Document | Use it when |
| --- | --- |
| [Architecture](architecture.md) | Finding the package, module, or owner responsible for a change |
| [Data flow](data-flow.md) | Changing ingestion, updates, computations, history, or decimation |
| [Rendering](rendering.md) | Changing layout, draw commands, styles, surfaces, or frame scheduling |
| [Extensions](extensions.md) | Adding a series, indicator, plugin, input consumer, or custom painter |
| [Development](development.md) | Setting up the repository and choosing verification commands |
| [Performance](performance.md) | Measuring a change or preserving limits on work and bundle size |

Start with [PRINCIPLES.md](../PRINCIPLES.md) for the design and contribution
rules. Architecture provides the implementation map; the other documents
follow the paths most changes touch.

## Keeping these documents current

[AGENTS.md](../AGENTS.md) provides the repository entry instructions for coding
agents. These documents supply the implementation context; current source and
tests supply the evidence. Neither requires private records or session memory.

Each document links to its implementation and relevant tests. When changing a
contract, update its explanation and tests together. Source links identify the
owner; they do not make an untested claim true.

Private ADRs and historical development records informed these explanations,
but are not dependencies of this documentation. New contributors should be
able to follow the current design using this repository alone.

For library usage, see the [user documentation](../apps/docs/guide/getting-started.md).
Package READMEs describe their public entrypoints. This directory describes
their implementation and maintenance rather than duplicating the user guides.
