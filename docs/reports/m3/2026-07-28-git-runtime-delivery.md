# M3 Bundled Git Runtime Delivery

- Date: 2026-07-28
- Updated: 2026-07-29
- Scope: fixed runtime sources, integrity checks, macOS build, Windows archive extraction, Electron packaging, and local qualification
- Status: delivery pipeline and four-architecture packaging qualification complete; network and release-signing evidence remain open

## Implemented delivery contract

- The manifest fixes Git 2.55.0 for macOS and Git for Windows 2.55.0.windows.3 for Windows, with a source URL and SHA-256 for every input.
- Windows x64 and arm64 use official MinGit archives and preserve their complete architecture, helper, CA, template, shell, and license directories.
- macOS x64 and arm64 build the official kernel.org source on a matching host architecture. The build disables optional Perl, Python, Tcl/Tk, gettext, and OpenSSL dependencies, uses Apple CommonCrypto and system libcurl, and targets macOS 12.0.
- Archive entries are checked for absolute paths and traversal before extraction. Existing invalid runtime directories are never overwritten automatically.
- macOS helper symlinks remain relative and compact. Manifest-required files are materialized only after their resolved targets are proven to stay inside the runtime root, so required-path verification remains symlink-free without expanding every Git builtin during packaging.
- Every runtime carries target/version/source metadata. Verification checks required file types and runs init, add, commit, switch, diff, and log on matching hosts.
- Electron packages copy only the prepared target runtime to `resources/git` outside `app.asar`. The main process injects the runtime's exec path, templates, and CA bundle without exposing them to Renderer IPC.

## Current evidence

- Git for Windows release metadata provided SHA-256 values for both MinGit archives; both downloaded archives matched those values during source inspection.
- The macOS arm64 source build produced and qualified Git 2.55.0 from the pinned source and CA bundle. The relocated runtime completed init, add, commit, switch, diff, and log operations and linked only Apple frameworks and system libraries.
- The macOS arm64 Electron package completed successfully. Its packaged `Contents/Resources/git/bin/git` is an executable arm64 Mach-O, the packaged runtime requalified successfully, and the packaged application passed the Electron readiness smoke test.
- Preserving internal helper symlinks reduced the packaged Git runtime from an invalid 803 MB hardlink-expanded result to 48 MB. The complete local `.app` is 363 MB before signing.
- Runtime tooling tests passed 3/3. Repository boundaries, lint, type checking, all workspace unit tests, all seven workspace builds, and Electron Playwright tests (6/6) passed with Node.js 24.16.0 and pnpm 11.7.0.
- GitHub Actions run [30420297175](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30420297175) passed macOS x64/arm64 and Windows x64/arm64 packaging. Every target passed runtime qualification, its platform-specific packaged-path assertion, and artifact upload. macOS targets and Windows x64 also passed packaged application smoke tests; Windows arm64 retained its explicit startup-evidence gap.
- Quality run [30420297168](https://github.com/Little-LittleProgrammer/author-copilot/actions/runs/30420297168) passed repository formatting, boundaries, lint, type checking, tests, builds, and Electron E2E. Lint reports four existing Fast Refresh warnings and no errors. Generated pnpm lockfiles are excluded from Prettier to avoid formatter/package-manager churn.
- Local packaging was unsigned because no Developer ID identity is installed; signing and notarization remain release evidence, not local qualification.

## Open exit conditions

- Add HTTPS and SSH fixture qualification, host fingerprint rejection, enterprise CA success/failure, credential-store integration, SBOM generation, and signing/notarization evidence.
- Git for Windows MinGit contains `usr/bin/sh.exe` but not `bash.exe`. This satisfies the M3 Git subprocess scope, not the M6 Agent SDK Bash requirement. M6 must select and qualify an additional shell distribution or remove that product assumption.
