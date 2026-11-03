/**
 * Native Durable Ask extension (settings-only).
 *
 * Desktop behavior in `src/index.ts` is unchanged. This module adds a separate
 * `/durable` factory that returns a native Extension for a Durable 1.1 host.
 * The factory accepts only serializable configuration; execution context and
 * native api objects come from Durable at execute time. There are no admission,
 * quota, authorization, credential-store, or host callback frameworks.
 *
 * What it does:
 * - Registers one native tool `ask` with `{ question }`. `replay: "unsafe"`
 *   because provider spend must not rerun after an uncertain interruption.
 * - On execute, creates an owned child conversation
 *   (`ownership: { kind: "task", taskId: api.taskId }`), configures its agent to
 *   exactly the intersection of the allowlist with the parent agent's actual
 *   tools (so it cannot reactivate a tool the host omitted for the parent),
 *   selects this extension so its guard hook applies, writes the
 *   conversation-scoped guard document active, submits the question with a
 *   deterministic request id scoped to the ask task, waits for the settled
 *   submission, reads the assistant answer entry, then restores the child to
 *   unrestricted state in a final commit.
 * - Guard: `hook(ToolTask, { beforeTool })` reads `pi-ask.state` through
 *   `HookApi.snapshot` and blocks any tool not in the active allowlist. It
 *   fails closed: when the guard state cannot be verified, the call is blocked.
 *   This is the second check after the child's exact tool selection; both are
 *   per conversation. State is conversation-scoped with `fork: "initial"`, so a
 *   fork starts unrestricted. No process-global active guard and no desktop
 *   event bus.
 *
 * Concrete native exclusions (not placeholders):
 * - No `/ask` or `/ask tools` slash commands: Durable extensions have no command
 *   surface. `/ask tools` becomes the native `ask` tool plus host inspection of
 *   the registry snapshot.
 * - No desktop `pi.events` guard acquire/release/probe protocol,
 *   `pi.setActiveTools`, provenance/`sourceInfo`, or exact top-level input
 *   constraints. The native guard enforces allowed tool names and exact child
 *   tool selection; it does not claim desktop interop.
 * - No TUI status badge and no `before_agent_start` context injection.
 */
import {
  configure,
  defineDoc,
  defineExtension,
  defineTool,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import type { EntryId, Extension, ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";

export const ASK_DURABLE_EXTENSION_NAME = "pi-ask";

const DEFAULT_ASK_TOOLS = [
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
] as const;

const DEFAULT_MAX_ANSWER_CHARS = 100_000;
const MAX_MAX_ANSWER_CHARS = 1_000_000;

export type AskDurableSettings = {
  /** Exact native tool names the restricted answer may call. Defaults to the built-in read-only policy. */
  readonly allowedTools?: readonly string[];
  /** Maximum answer characters returned to the caller. Default 100000. */
  readonly maxAnswerChars?: number;
};

type AskGuardState = {
  active: boolean;
  allowedTools: string[];
};

const AskStateDoc = defineDoc({
  kind: "pi-ask.state",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: (): AskGuardState => ({ active: false, allowedTools: [] }),
});

const askParameters = Type.Object({
  question: Type.String({
    minLength: 1,
    maxLength: 32_000,
    description: "Question for the owned restricted child conversation to answer.",
  }),
});

function normalizeAllowedTools(input: readonly string[] | undefined): string[] {
  const source = input ?? [...DEFAULT_ASK_TOOLS];
  const seen = new Set<string>();
  for (const name of source) {
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!seen.has(trimmed)) seen.add(trimmed);
  }
  if (seen.size === 0) throw new Error("ask durable settings: allowedTools must list at least one tool name.");
  return [...seen];
}

function normalizeMaxAnswerChars(input: number | undefined): number {
  if (input === undefined) return DEFAULT_MAX_ANSWER_CHARS;
  if (!Number.isInteger(input) || input < 1 || input > MAX_MAX_ANSWER_CHARS) {
    throw new Error(
      `ask durable settings: maxAnswerChars must be an integer 1..${MAX_MAX_ANSWER_CHARS}.`,
    );
  }
  return input;
}

function boundReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 2000 ? `${message.slice(0, 2000)}… [truncated]` : message;
}

type ModelPart = { type?: unknown; text?: unknown };
function extractAssistantText(model: unknown): string {
  if (!Array.isArray(model) || model.length === 0) return "";
  const message = model[0] as { content?: unknown };
  const content = Array.isArray(message?.content) ? (message.content as ModelPart[]) : [];
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

/** Native settings-only Ask extension. Settings are copied and frozen at creation. */
export function createAskDurableExtension(settings: AskDurableSettings = {}): Extension {
  const allowedTools = Object.freeze(normalizeAllowedTools(settings.allowedTools));
  const maxAnswerChars = normalizeMaxAnswerChars(settings.maxAnswerChars);

  const askTool = defineTool({
    name: "ask",
    description:
      "Ask one question in an owned restricted child conversation. The child may call only the configured allowlist; the parent conversation is never modified. Returns the bounded child answer text.",
    parameters: askParameters,
    replay: "unsafe",
    async execute(args, api, context) {
      const question = (args as { question: string }).question;
      const requestId = `ask:${String(api.taskId)}`;
      try {
        const parentAgent = await api.agent(context);
        const parentToolByName = new Map(parentAgent.tools.map((tool) => [tool.name, tool] as const));
        const effective = allowedTools.filter((name) => parentToolByName.has(name));

        const childId = await api.commit(async (tx) => {
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
          // Retain the actual ordered parent extension selection (preserving
          // parent overrides and wrappers) and ensure the guard extension is
          // selected; narrow the child tools to allowed parent tool names.
          // configure() persists only names; the cast bridges Tool to the
          // ToolRegistration structural gap (execute lives in the registry,
          // not in stored agent state). Real parent-selected objects pass.
          const extensions = [...parentAgent.extensions];
          if (!extensions.some((extension) => extension.name === ASK_DURABLE_EXTENSION_NAME)) {
            const askExtension = api.registry.extension(ASK_DURABLE_EXTENSION_NAME);
            if (!askExtension) throw new Error("ask durable extension is not installed in the host registry.");
            extensions.push(askExtension);
          }
          const effectiveTools = effective.flatMap((name) => {
            const found = parentToolByName.get(name);
            return found ? [found] : [];
          });
          await configure(
            tx,
            child.id,
            {
              extensions,
              tools: effectiveTools as unknown as ToolRegistration[],
            },
          );
          const guard = await tx.doc(AskStateDoc, child.id);
          guard.active = true;
          guard.allowedTools = [...effective];
          return child.id;
        }, context);

        const handle = await api.conversation(childId, context);
        if (!handle) {
          return {
            isError: true,
            content: [{ type: "text", text: "ask failed: owned child conversation is unavailable." }],
          };
        }
        const submission = await handle.submit(
          { type: "input", content: question, requestId, whenBusy: "followUp" },
          context,
        );
        const settled = await submission.wait(context);
        if (settled.status !== "done" || !("answer" in settled)) {
          await api.commit(async (tx) => {
            const guard = await tx.doc(AskStateDoc, childId);
            guard.active = false;
            guard.allowedTools = [];
          }, context);
          const reason =
            settled.status === "unanswered" ? (settled as { reason?: unknown }).reason : "submission did not settle";
          return {
            isError: true,
            content: [{ type: "text", text: `ask failed: ${boundReason(reason)}` }],
          };
        }

        const answerId = (settled as { answer: EntryId }).answer;
        const fullText = await api.commit(async (tx) => {
          const entry = await tx.entry(answerId);
          return extractAssistantText(entry?.model);
        }, context);

        let text = fullText;
        let truncated = false;
        if (text.length > maxAnswerChars) {
          text = text.slice(0, maxAnswerChars);
          truncated = true;
        }

        await api.commit(async (tx) => {
          const guard = await tx.doc(AskStateDoc, childId);
          guard.active = false;
          guard.allowedTools = [];
        }, context);

        if (!text) {
          return {
            isError: true,
            content: [{ type: "text", text: "ask failed: the restricted answer contained no text." }],
            details: { conversationId: Number(childId) },
          };
        }

        return {
          content: [{ type: "text", text }],
          ...(truncated
            ? { diagnostics: [{ severity: "warn" as const, message: `Answer truncated to ${maxAnswerChars} characters.` }] }
            : {}),
          details: { conversationId: Number(childId), ...(truncated ? { truncated: true as const } : {}) },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `ask failed: ${boundReason(error)}` }],
        };
      }
    },
  });

  const guardHook = hook(ToolTask, {
    beforeTool: async (call, api, context) => {
      let state: AskGuardState | undefined;
      try {
        state = await api.snapshot(AskStateDoc, api.conversationId, context);
      } catch {
        // Fail closed: an unverifiable guard state must not permit the call.
        return {
          block: `The ${call.name} tool cannot run because the Ask guard state could not be verified for this conversation.`,
        };
      }
      if (!state?.active) return undefined;
      if (state.allowedTools.includes(call.name)) return undefined;
      return {
        block: `The ${call.name} tool is unavailable while the Ask guard is active for this conversation.`,
      };
    },
  });

  return defineExtension({
    name: ASK_DURABLE_EXTENSION_NAME,
    tools: [askTool],
    hooks: [guardHook],
  });
}
