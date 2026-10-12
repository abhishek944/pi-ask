# pi-ask

A small [Pi](https://pi.dev) extension for simple, one-shot questions.

`/ask` temporarily narrows Pi's active tools, sends one question, and restores the exact previous tool set when the answer finishes. It does not require a deep investigation, web research, a plan, or repository changes.

## Install

From npm:

```sh
pi install npm:@abhishek944/pi-ask
```

Or directly from GitHub:

```sh
pi install git:github.com/abhishek944/pi-ask@v0.2.0
```

Restart Pi after installing, or run `/reload` in an existing session.

## Use

```text
/ask What does this function return?
```

The question runs with only the approved tools that were already active:

- `read`
- `grep`
- `find`
- `ls`
- `web_enable`
- `web_search`
- `source_check`
- `fetch_content`
- `get_search_content`
- `image_generate`
- `sprite_generate`
- `MonitorList`
- `LoopList`
- `WorkList`
- `TodoList`

`web_enable` can activate the configured web lookup tools during the answer. Sprite generation requires `pi-image-gen.spriteGeneration.enabled` to be true. Allowlisting a tool does not install or enable a disabled extension.

Shell access and file-changing tools such as `bash`, `edit`, and `write` are unavailable. Other unapproved extension tools are unavailable too.

Image and sprite generation are intentionally allowed and may create output files. Work, todo, loop, and monitor mutations remain unavailable. All other project-file changes are blocked by removing those tools and by a second check immediately before any tool call.

When the answer settles, Pi restores the exact tool list that was active before `/ask`.

## Reusable guard

Other Pi extensions can request the same guard through Pi's shared event bus. The guard narrows the current tool set, checks every tool call again immediately before execution, supports exact top-level input constraints, and restores the previous tools after `agent_settled` or session shutdown.

```ts
import type { PiAskGuardAcquireRequest } from "@abhishek944/pi-ask/guard";

const request: PiAskGuardAcquireRequest = {
  ownerId: "my-extension:restricted-run",
  allowedTools: [
    "read",
    "grep",
    { name: "my_status_tool", equals: { id: "expected-id" } },
  ],
  context: "This run is read-only.",
  startsRun: true,
};
pi.events.emit("pi-ask:guard:acquire", request);
if (request.response?.status !== "active" || !request.response.acquisitionToken) {
  // Fail closed: do not start the unrestricted agent run.
}

// If startup fails before the run begins, release with the exact returned token:
function cancelBeforeStart() {
  pi.events.emit("pi-ask:guard:release", {
    ownerId: request.ownerId,
    acquisitionToken: request.response!.acquisitionToken!,
  });
}
```

Built-in tool names are accepted only when `pi.getAllTools()` reports Pi's matching built-in provenance, so an extension cannot replace `read` and inherit permission by name. Rules for extension tools can add `sourceInfo: { source, path }` when the caller depends on one exact implementation; Pi Ask verifies that metadata before activation.

Only one restricted run can own the guard at a time. Callers must require the synchronous `active` response before starting work. Pi must be idle before a caller acquires with `startsRun: true` and immediately invokes `pi.sendMessage(..., { triggerTurn: true })`; this lets Pi Ask associate restoration with that complete run rather than with retry-level starts. Programmatic custom-message runs do not emit `before_agent_start`, so callers must also include any required guard context in the message itself.

Extensions that start unguarded custom-message runs during another run's settlement should emit `pi-ask:guard:run-start` immediately before `pi.sendMessage`. This keeps complete-run ordering intact for a later guarded wake. The event is only a lifecycle marker and does not activate restrictions. In ordinary agent runs, restoration is automatic; `pi-ask:guard:release` is available for a caller that must cancel before the agent starts. Pi Ask emits `pi-ask:guard:released` after restoration so waiting clients can resume without polling.

The guard module is exported as `@abhishek944/pi-ask/guard`. The `pi-ask` extension must also be loaded so its shared-event listeners are registered.

## Notes

- `/ask` needs a question. Running it without text shows a short usage message.
- Lookup, status, image, and sprite tools are optional. Pi uses them only when helpful.
- Wait for the `/ask` answer to finish before sending another agent prompt. Anything queued into the same agent run keeps the limited tool set until Pi settles.
- If startup fails before Pi begins the answer, run `/ask reset` once Pi is idle, or use `/reload`. Either command restores the previous tools.
- Built-in slash commands and shell commands typed directly by the user are outside this model-tool guardrail.
- This is an extension-level guardrail, not an operating-system sandbox.

## License

Apache-2.0
