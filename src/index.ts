import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createPiAskGuard, type PiAskGuard } from "./guard.js";

const ASK_OWNER_ID = "pi-ask:/ask";
const ASK_TOOLS_COMMAND = /^\/ask\s+tools$/;
const MAX_LISTED_TOOL_NAMES = 24;
const ASK_TOOL_NAMES = [
  "read",
  "grep",
  "find",
  "ls",
  "web_enable",
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
  "image_generate",
  "sprite_generate",
  "MonitorList",
  "LoopList",
  "WorkList",
  "TodoList",
];

function formatToolNames(names: string[]): string {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return "    (none)";
  const shown = sorted.slice(0, MAX_LISTED_TOOL_NAMES);
  const lines = [`    ${shown.join(", ")}`];
  if (shown.length < sorted.length) {
    lines.push(`    …and ${sorted.length - shown.length} more (${sorted.length} total)`);
  }
  return lines.join("\n");
}

// Local, metadata-only report for `/ask tools`. It reads the live active tool set
// and the registered-tool registry, and never acquires the guard, changes active
// tools, starts a model turn, or persists anything.
function buildAskToolsReport(pi: ExtensionAPI, guard: PiAskGuard): string {
  const active = pi.getActiveTools();
  const registered = new Set(pi.getAllTools().map((tool) => tool.name));
  const policy = new Set(ASK_TOOL_NAMES);
  const askOwnsGuard = guard.isActive(ASK_OWNER_ID);
  const restrictedRunActive = guard.isActive();

  const effective = active.filter((name) => policy.has(name));
  const activeOutsidePolicy = active.filter((name) => !policy.has(name));
  const inactiveAllowed = ASK_TOOL_NAMES.filter((name) => registered.has(name) && !active.includes(name));
  const absentAllowed = ASK_TOOL_NAMES.filter((name) => !registered.has(name));
  const lines: string[] = [];

  if (askOwnsGuard) {
    lines.push("Ask tools (active)");
    lines.push(`The built-in Ask policy is active. Effective tools for this answer (${effective.length} of ${ASK_TOOL_NAMES.length} allowlisted):`);
    lines.push(formatToolNames(effective));
    if (activeOutsidePolicy.length > 0) {
      lines.push(`Active but still blocked by the Ask guard (${activeOutsidePolicy.length}):`);
      lines.push(formatToolNames(activeOutsidePolicy));
    }
  } else if (restrictedRunActive) {
    lines.push("Ask tools (restricted run active)");
    lines.push("Another extension owns the current restricted run, so the built-in Ask policy is not in effect. This report cannot verify that run's policy.");
    lines.push(`Active tools now (${active.length}):`);
    lines.push(formatToolNames(active));
    lines.push("Ask cannot start until that restricted run finishes. Run /ask tools again afterward for an Ask preview.");
    lines.push("Registered or active names are not a health check; a tool or provider may still fail at runtime.");
    return lines.join("\n");
  } else {
    lines.push("Ask tools (preview)");
    lines.push("Ask is not active. This preview is based on the tools active right now; it changes nothing.");
    lines.push(`Available if /ask runs now (${effective.length} of ${ASK_TOOL_NAMES.length} allowlisted):`);
    lines.push(formatToolNames(effective));
    if (activeOutsidePolicy.length > 0) {
      lines.push(`Active now but removed for an Ask run (${activeOutsidePolicy.length}):`);
      lines.push(formatToolNames(activeOutsidePolicy));
    }
  }

  if (inactiveAllowed.length > 0) {
    lines.push(`Allowlisted but inactive right now (${inactiveAllowed.length}):`);
    lines.push(formatToolNames(inactiveAllowed));
    if (registered.has("web_enable")) {
      lines.push("web_enable can add the configured web lookup tools during an answer; this report re-reads the active tool set each time.");
    }
  }
  if (absentAllowed.length > 0) {
    lines.push(`Allowlisted but not registered in Pi (${absentAllowed.length}):`);
    lines.push(formatToolNames(absentAllowed));
    lines.push("Pi has no registered tool with these names right now. The reason is unknown; this report cannot tell whether a tool was never installed, is disabled, or was not provided.");
  }

  lines.push("Always blocked for an Ask run: shell and file-changing tools such as bash, edit and write are removed and re-checked before every call; work, todo, loop and monitor mutations are not in the Ask policy (only their list and status tools are).");
  lines.push("File-writing exception: image_generate and sprite_generate may create image files.");
  lines.push("Registered or active names are not a health check; a tool or provider may still fail at runtime.");
  return lines.join("\n");
}

export default function askExtension(pi: ExtensionAPI): void {
  let latestCtx: ExtensionContext | undefined;
  const guard = createPiAskGuard(pi, {
    onReleased: (ctx) => {
      (ctx ?? latestCtx)?.ui.setStatus("ask", undefined);
    },
  });

  pi.on("input", (event, ctx) => {
    latestCtx = ctx;

    if (ASK_TOOLS_COMMAND.test(event.text)) {
      ctx.ui.notify(buildAskToolsReport(pi, guard), "info");
      return { action: "handled" };
    }

    // A failed startup can leave tools selected without a run to settle.
    if (ctx.isIdle() && guard.isActive(ASK_OWNER_ID)) {
      const token = guard.getAcquisitionToken();
      if (token) guard.release(ASK_OWNER_ID, token, ctx);
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
    });
    if (result.status !== "active" || !result.acquisitionToken) {
      return { action: "handled" };
    }
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
