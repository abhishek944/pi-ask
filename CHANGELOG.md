# Changelog

## 0.4.3 - 2026-10-18

- Keep `/ask` tool restrictions scoped to its answer without injecting Ask Mode instructions into the conversation.
- Remove the manual `/ask reset` command and automatically restore leftover Ask tools before the next idle prompt.
- Preserve the reusable guard API and restrictions owned by other extensions.

## 0.4.2

- Removed the active restricted-answer warning for `/ask`.
- Automatically clear the previous Ask guard before starting a new idle `/ask`, so stale Ask state no longer silently blocks the command.

## 0.4.1 - 2026-10-17

- Fixed Ask startup with Pi 1.3.0 by accepting both current and legacy built-in tool provenance paths while preserving the existing tool restrictions.
- Removed the misleading acquisition-failure warning that claimed another restricted answer was active. Failed guard activation still prevents an unrestricted answer.

## 0.4.0 - 2026-10-17

- Added `/ask tools`, a local metadata-only report of the effective Ask tools, tools removed by the Ask policy, and allowlisted tools that are inactive or not registered. It starts no model turn, changes no guard or tool state, and labels itself a preview when Ask is not active.

## 0.3.0 - 2026-10-12

- Allowed optional web activation, sprite generation, and read-only work, todo, loop, and monitor status tools during `/ask`.
- Clarified that image and sprite outputs are allowed while tracking mutations and other project-file changes remain blocked.

## 0.2.0 - 2026-09-12

- Added the reusable read-only guard API and shared event protocol.
- Added exact top-level tool-input constraints, tool-provenance checks, complete-run lifecycle tracking, and automatic restoration.
- Added programmatic run markers and guard release notifications for extension integrations.

## 0.1.0

- Initial `/ask` release.
