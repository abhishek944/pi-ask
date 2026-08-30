import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ASK_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
  "image_generate",
]);

export default function askExtension(pi: ExtensionAPI): void {
  let askActive = false;
  let toolsBeforeAsk: string[] | undefined;

  function restoreTools(ctx?: ExtensionContext): void {
    if (!askActive) return;

    if (toolsBeforeAsk) pi.setActiveTools(toolsBeforeAsk);

    toolsBeforeAsk = undefined;
    askActive = false;
    ctx?.ui.setStatus("ask", undefined);
  }

  pi.on("input", (event, ctx) => {
    if (askActive && event.text === "/ask reset") {
      if (!ctx.isIdle()) {
        ctx.ui.notify("The current /ask answer is still running.", "warning");
        return { action: "handled" };
      }
      restoreTools(ctx);
      ctx.ui.notify("Ask mode cleared. Your previous tools were restored.", "info");
      return { action: "handled" };
    }

    if (askActive && event.text.startsWith("/ask")) {
      ctx.ui.notify("An /ask question is already running.", "warning");
      return { action: "handled" };
    }

    const match = event.text.match(/^\/ask(?:\s+([\s\S]*))?$/);
    if (!match) return;

    const question = match[1]?.trim();
    if (!question) {
      ctx.ui.notify("Usage: /ask <question>", "info");
      return { action: "handled" };
    }

    if (!ctx.isIdle()) {
      ctx.ui.notify("Wait for the current answer to finish before using /ask.", "warning");
      return { action: "handled" };
    }

    toolsBeforeAsk = pi.getActiveTools();
    const askTools = toolsBeforeAsk.filter((name) => ASK_TOOL_NAMES.has(name));
    pi.setActiveTools(askTools);
    askActive = true;
    ctx.ui.setStatus("ask", ctx.ui.theme.fg("warning", "ask"));

    return event.images
      ? { action: "transform", text: question, images: event.images }
      : { action: "transform", text: question };
  });

  pi.on("before_agent_start", () => {
    if (!askActive) return;

    return {
      message: {
        customType: "pi-ask-context",
        content:
          "[ASK MODE]\nAnswer the question directly and concisely. Use the available lookup or image tool only when it is genuinely helpful. Do not change project files or run shell commands.",
        display: false,
      },
    };
  });

  pi.on("context", (event) => {
    if (askActive) return;

    return {
      messages: event.messages.filter(
        (message) => !("customType" in message && message.customType === "pi-ask-context"),
      ),
    };
  });

  pi.on("tool_call", (event) => {
    if (!askActive || ASK_TOOL_NAMES.has(event.toolName)) return;

    return {
      block: true,
      reason: `The ${event.toolName} tool is unavailable while answering /ask.`,
    };
  });

  pi.on("agent_settled", (_event, ctx) => {
    restoreTools(ctx);
  });

  pi.on("session_shutdown", () => {
    restoreTools();
  });
}
