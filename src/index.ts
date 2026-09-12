import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPiAskGuard } from "./guard.js";

const ASK_OWNER_ID = "pi-ask:/ask";
const ASK_TOOL_NAMES = [
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
  "image_generate",
];

export default function askExtension(pi: ExtensionAPI): void {
  let latestCtx: ExtensionContext | undefined;
  let askAcquisitionToken: string | undefined;
  const guard = createPiAskGuard(pi, {
    onReleased: (ctx) => {
      askAcquisitionToken = undefined;
      (ctx ?? latestCtx)?.ui.setStatus("ask", undefined);
    },
  });

  pi.on("input", (event, ctx) => {
    latestCtx = ctx;
    if (guard.isActive(ASK_OWNER_ID) && event.text === "/ask reset") {
      if (!ctx.isIdle()) {
        ctx.ui.notify("The current /ask answer is still running.", "warning");
        return { action: "handled" };
      }
      if (!askAcquisitionToken || !guard.release(ASK_OWNER_ID, askAcquisitionToken, ctx)) {
        ctx.ui.notify("Ask mode could not restore its tools safely.", "error");
        return { action: "handled" };
      }
      ctx.ui.notify("Ask mode cleared. Your previous tools were restored.", "info");
      return { action: "handled" };
    }

    if (guard.isActive() && event.text.startsWith("/ask")) {
      ctx.ui.notify("A restricted answer is already running.", "warning");
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

    const result = guard.acquire({
      ownerId: ASK_OWNER_ID,
      allowedTools: ASK_TOOL_NAMES,
      context:
        "[ASK MODE]\nAnswer the question directly and concisely. Use the available lookup or image tool only when it is genuinely helpful. Do not change project files or run shell commands.",
    });
    if (result.status !== "active" || !result.acquisitionToken) {
      ctx.ui.notify("Ask mode could not start because another restricted answer is active.", "warning");
      return { action: "handled" };
    }
    askAcquisitionToken = result.acquisitionToken;
    ctx.ui.setStatus("ask", ctx.ui.theme.fg("warning", "ask"));

    return event.images
      ? { action: "transform", text: question, images: event.images }
      : { action: "transform", text: question };
  });

  pi.on("before_agent_start", () => {
    const context = guard.getContext();
    if (!context) return;
    return {
      message: {
        customType: "pi-ask-context",
        content: context,
        display: false,
        details: { acquisitionToken: guard.getAcquisitionToken() },
      },
    };
  });

  pi.on("context", (event) => {
    const acquisitionToken = guard.getAcquisitionToken();
    return {
      messages: event.messages.filter((message) => {
        if (!("customType" in message) || message.customType !== "pi-ask-context") return true;
        if (!acquisitionToken) return false;
        return (message as { details?: { acquisitionToken?: string } }).details?.acquisitionToken === acquisitionToken;
      }),
    };
  });
}

export {
  createPiAskGuard,
  PI_ASK_GUARD_ACQUIRE_EVENT,
  PI_ASK_GUARD_PROBE_EVENT,
  PI_ASK_GUARD_RELEASE_EVENT,
  PI_ASK_GUARD_RELEASED_EVENT,
  PI_ASK_GUARD_RUN_START_EVENT,
} from "./guard.js";
export type {
  GuardConstraintValue,
  PiAskGuard,
  PiAskGuardAcquireRequest,
  PiAskGuardAcquireResult,
  PiAskGuardProbeRequest,
  PiAskGuardReleaseRequest,
  PiAskGuardToolRule,
} from "./guard.js";
