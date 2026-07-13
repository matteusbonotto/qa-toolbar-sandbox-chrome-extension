# Dependency audit — 2026-07-13

`npm audit` reports advisories in WXT development dependencies, primarily the Firefox runner chain (`web-ext-run`, `fx-runner`, `shell-quote`, `tmp` and `node-notifier`). WXT 0.20.27 currently exposes no complete upstream fix for that chain.

These packages are build/dev tooling and are not shipped in the MV3 bundle. Mitigations for this cut: WXT is a `devDependency`, CI installs from lockfile, production audit runs with `--omit=dev`, Firefox runner is not used in CI, and dependency updates are monitored. The risk remains open and must be reassessed before Firefox packaging or running untrusted extension paths through the dev runner.
