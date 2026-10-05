# Security policy

## Supported versions

Security fixes target the latest published version of the `@finchart/*` packages.
Older releases do not have separate maintained branches.

## Reporting a vulnerability

Use the private **Report a vulnerability** option on the repository's
[Security page](https://github.com/FutureSeller/finchart/security) when available.
If it is unavailable, open an issue requesting a private contact channel
without including any vulnerability details. Do not post vulnerabilities, credentials,
account information, or exploit details in a public issue or PR.

Include affected versions, a minimal synthetic reproduction, expected impact,
and any suggested mitigation. Reports are handled by the maintainer; no response
time or bounty is promised.

## Development and demos

The Toss market-data demo uses synthetic data by default. Its live credentials
belong only in ignored server environment files. Never include account or order
data in contributions, fixtures, logs, or screenshots.
