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
pi install git:github.com/abhishek944/pi-ask@v0.1.0
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
- `web_search`
- `source_check`
- `fetch_content`
- `get_search_content`
- `image_generate`

Shell access and file-changing tools such as `bash`, `edit`, and `write` are unavailable. Other unapproved extension tools are unavailable too.

Image generation is intentionally allowed and may create image files. All other project-file changes are blocked by removing those tools and by a second check immediately before any tool call.

When the answer settles, Pi restores the exact tool list that was active before `/ask`.

## Notes

- `/ask` needs a question. Running it without text shows a short usage message.
- Lookup and image tools are optional. Pi uses them only when helpful.
- Wait for the `/ask` answer to finish before sending another agent prompt. Anything queued into the same agent run keeps the limited tool set until Pi settles.
- If startup fails before Pi begins the answer, run `/ask reset` once Pi is idle, or use `/reload`. Either command restores the previous tools.
- Built-in slash commands and shell commands typed directly by the user are outside this model-tool guardrail.
- This is an extension-level guardrail, not an operating-system sandbox.

## License

Apache-2.0
