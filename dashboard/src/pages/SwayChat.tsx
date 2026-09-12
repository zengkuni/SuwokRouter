import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  LockKeyhole,
  Paperclip,
  Pencil,
  Search,
  Copy,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Header } from "@/components/Header";
import {
  ProviderModelAccordion,
  ProviderModelIcon,
} from "@/components/ProviderModelAccordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Frame, FramePanel } from "@/components/ui/frame";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/api";
import { probeEnabled } from "@/lib/live-mode";
import { fetchSettings, type AppSettings } from "@/lib/settings-api";
import { getActiveGatewayApiKey } from "@/lib/api-keys-api";
import type { ModelInfo } from "@/lib/cli-tools-api";
import {
  MAX_IMAGES_PER_MSG,
  MAX_IMAGE_PAYLOAD_BYTES,
  MAX_CHAT_REQUEST_BYTES,
  buildModelAwareSystemPrompt,
  buildRequestMessages,
  compactHistory,
  createId,
  elapsedChatDuration,
  estimateJsonBytes,
  fileToDataURL,
  formatDuration,
  formatThinkingDuration,
  getThinkingPhase,
  normalizeChatDuration,
  formatTokenCount,
  groupModels,
  isAcceptedImage,
  readAssistantText,
  readAssistantThinking,
  readStreamUsage,
  shouldCompact,
  textValue,
  type Attachment,
  type ChatMessage,
  SWAY_CHAT_WORKSPACE_STORAGE,
  parseSwayChatWorkspace,
  reconcileSwayChatModel,
  serializeSwayChatWorkspace,
} from "@/lib/chatStudio";
import {
  SWAY_AGENT_TOOLS,
  agentToolLabel,
  compactToolResult,
  executeSwayTool,
  type AgentApprovalRequest,
  type AgentToolActivity,
  type AgentToolCall,
} from "@/lib/chatAgent";

const LAST_MODEL_STORAGE = "sway-chat.lastModel";
const API_KEYS_ROUTE = "/dashboard/manage-apikey";
const DEFAULT_SYSTEM_PROMPT = "You are Sway Router Assistant, the capable internal agent of the Sway Router platform. Be a practical senior engineer and operator: understand the Router, inspect it when asked, use the right tools, solve problems step by step when useful, and explain what you found. When asked for the total number of providers, count the unique union of built-in registry providers and custom provider nodes, including providers with no connections; use router_overview.summary.totalProviders for that total and distinguish it from registeredProviderTypes, configuredProviders, activeProviders, and inactiveOnlyProviders. Never report activeProviders or connectedProviders as the total. Respond in the user's language, stay concise by default, ask a clarifying question when a request is underspecified, and use Markdown for readability. Format code in fenced blocks with the correct language and state uncertainty clearly instead of inventing facts.";

type ModelsPayload = { data?: Array<{ id?: string; name?: string; owned_by?: string; capabilities?: Record<string, unknown> }> };

async function fetchChatModels(): Promise<ModelInfo[]> {
  const apiKey = await getActiveGatewayApiKey().catch(() => "");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch("/v1/models", { credentials: "include", headers });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } | string; message?: string } | null;
    throw new Error(textValue(data?.error ?? data?.message) || `Models request failed (${res.status})`);
  }
  const payload = (await res.json()) as ModelsPayload;
  return (payload.data ?? []).flatMap((model) => {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return [];
    const provider = typeof model.owned_by === "string" && model.owned_by ? model.owned_by : id.includes("/") ? id.split("/", 1)[0] : "other";
    return [{ id, name: model.name?.trim() || id, provider, capabilities: model.capabilities }];
  });
}

function modelDisplayName(model?: ModelInfo): string {
  const label = model?.name?.trim() || model?.id?.trim() || "";
  const parts = label.split("/").filter(Boolean);
  return parts[parts.length - 1] || label || "Select a model";
}

const PIXEL_DELAYS = [0, 90, 180, 90, 180, 270, 180, 270, 360];
const PIXEL_COLORS = [
  "bg-white",
  "bg-blue-200",
  "bg-blue-400",
  "bg-white/85",
  "bg-blue-600",
  "bg-white/70",
  "bg-blue-300",
  "bg-white/90",
  "bg-primary",
];

function PixelGrid({ muted = false }: { muted?: boolean }) {
  return (
    <span className="grid shrink-0 grid-cols-3 gap-[2px] p-0.5" aria-hidden="true">
      {PIXEL_DELAYS.map((delay, index) => (
        <span
          key={index}
          className={cn(
            "size-1 rounded-[1px]",
            PIXEL_COLORS[index],
            muted ? "opacity-25" : "animate-chat-pixel motion-reduce:animate-none",
          )}
          style={muted ? undefined : { animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function useMessageElapsed(message: ChatMessage) {
  const [elapsedMs, setElapsedMs] = useState(() => elapsedChatDuration(message.startAt));

  useEffect(() => {
    if (message.startAt == null || message.status !== "streaming") return;
    const update = () => setElapsedMs(elapsedChatDuration(message.startAt));
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [message.startAt, message.status]);

  return elapsedMs;
}

const StreamingStatus = memo(function StreamingStatus({ message }: { message: ChatMessage }) {
  const elapsedMs = useMessageElapsed(message);
  const phase = getThinkingPhase({
    content: message.content,
    thinking: message.thinking,
  });
  const label = phase === "Thinking" ? "Thinking…" : phase === "Writing" ? "Writing…" : phase;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="inline-flex items-center gap-2 rounded-md py-1 text-[12px] text-muted-foreground"
      aria-label={`${label}${elapsedMs > 0 ? `, ${formatThinkingDuration(elapsedMs)}` : ""}`}
      role="status"
      aria-live="polite"
    >
      <PixelGrid />
      <span className="animate-chat-shimmer bg-[length:200%_100%] bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-clip-text font-medium text-transparent motion-reduce:animate-none">
        {label}
      </span>
      <span className="font-mono tabular-nums opacity-60">{formatThinkingDuration(elapsedMs)}</span>
    </motion.div>
  );
});

const ReasoningHistory = memo(function ReasoningHistory({ message, open, onToggle }: { message: ChatMessage; open: boolean; onToggle: () => void }) {
  const elapsedMs = useMessageElapsed(message);
  const phase = getThinkingPhase({
    content: message.content,
    thinking: message.thinking,
  });
  const duration = message.thoughtMs != null ? formatThinkingDuration(message.thoughtMs) : "Thinking";
  const hasHiddenReasoning = !message.thinking && (message.streamUsage?.reasoning ?? 0) > 0;
  const reasoningTokens = message.streamUsage?.reasoning;
  const reasoningSteps = (message.thinking || "")
    .split(/\r?\n+/)
    .map((step) => step.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(-12);
  const streamingLabel = phase === "Thinking" ? "Thinking…" : phase === "Writing" ? "Writing…" : phase;
  const contentId = `thought-${message.id}`;
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="group flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        {message.status === "streaming" ? <PixelGrid /> : <Sparkles className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />}
        <span className={cn(
          "min-w-0 truncate font-medium",
          message.status === "streaming" && "animate-chat-shimmer bg-[length:200%_100%] bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-clip-text text-transparent motion-reduce:animate-none",
        )}>
          {message.status === "streaming" ? streamingLabel : `Thought for ${duration}`}
        </span>
        {message.status === "streaming" ? <span className="shrink-0 font-mono text-[10px] tabular-nums opacity-60">{formatThinkingDuration(elapsedMs)}</span> : null}
        {reasoningTokens != null && reasoningTokens > 0 ? <span className="shrink-0 rounded border border-border/70 bg-surface px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{formatTokenCount(reasoningTokens)} reasoning</span> : null}
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-200", !open && "-rotate-90")} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-border/60 bg-background/20"
          >
            <div className="px-3 pb-3 pt-2 text-xs leading-relaxed text-muted-foreground">
              {message.toolActivity?.length ? <AgentActivityView activities={message.toolActivity} /> : null}
              {reasoningSteps.length > 1 ? (
                <ol className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {reasoningSteps.map((step, index) => {
                    const current = message.status === "streaming" && index === reasoningSteps.length - 1;
                    return (
                      <li key={`${step}-${index}`} className="relative flex items-start gap-2">
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", current ? "animate-pulse bg-amber-300 motion-reduce:animate-none" : "bg-emerald-400")} aria-hidden="true" />
                        <span className={cn("min-w-0 break-words", current && "text-foreground")}>{step}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : message.thinking ? (
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{message.thinking}</div>
                ) : null}
              {hasHiddenReasoning ? <div className="text-muted-foreground/70">This model used hidden reasoning tokens, but did not return the reasoning text.</div> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}, (previous, next) => previous.message === next.message && previous.open === next.open);

function AssistantMetric({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <Tooltip label={title}>
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface/60 px-2 py-1">
        <span className="text-muted-foreground/75">{label}</span>
        <span className="font-medium text-foreground/85">{value}</span>
      </span>
    </Tooltip>
  );
}

const AssistantTelemetry = memo(function AssistantTelemetry({ message }: { message: ChatMessage }) {
  const usage = message.streamUsage;
  const hasCache = usage != null && (usage.cached != null || usage.cacheCreation != null);
  const hasUsage = usage != null && (usage.prompt != null || usage.completion != null || usage.reasoning != null || hasCache);
  if (message.ttfbMs == null && message.durationMs == null && !hasUsage) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
      {message.ttfbMs != null ? <AssistantMetric label="Response starts" value={formatDuration(message.ttfbMs)} title="Time until the model starts sending the answer." /> : null}
      {message.durationMs != null ? <AssistantMetric label="Completed in" value={formatDuration(message.durationMs)} title="Total time from sending your message until the answer finished." /> : null}
      {hasUsage && usage?.completion != null ? <AssistantMetric label="Answer length" value={`${formatTokenCount(usage.completion)} tokens`} title="Tokens generated in the answer." /> : null}
      {hasCache && usage?.cached != null && usage.cached > 0 ? <AssistantMetric label="Cache read" value={`${formatTokenCount(usage.cached)} tokens`} title="Input tokens served from the provider's prompt cache, which can reduce latency and cost." /> : null}
      {hasCache && usage?.cacheCreation != null && usage.cacheCreation > 0 ? <AssistantMetric label="Cache written" value={`${formatTokenCount(usage.cacheCreation)} tokens`} title="Input tokens written to the provider's prompt cache for later requests." /> : null}
    </div>
  );
});

type StreamReplyResult = {
  message: ChatMessage;
  toolCalls: AgentToolCall[];
  assistantContent: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mergeToolCallDeltas(target: Map<number, AgentToolCall>, value: unknown) {
  if (!Array.isArray(value)) return;
  value.forEach((raw, fallbackIndex) => {
    const item = asRecord(raw);
    if (!item) return;
    const parsedIndex = Number(item.index);
    const index = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : fallbackIndex;
    const current = target.get(index) || { id: `call_${index}`, type: "function", function: { name: "", arguments: "" } };
    const fn = asRecord(item.function);
    const name = asString(fn?.name ?? item.name);
    const rawArguments = fn?.arguments ?? item.arguments;
    const argumentsText = typeof rawArguments === "string"
      ? rawArguments
      : rawArguments == null
        ? ""
        : JSON.stringify(rawArguments);
    if (asString(item.id)) current.id = asString(item.id);
    if (asString(item.type)) current.type = asString(item.type);
    if (name) current.function.name = name;
    if (argumentsText) current.function.arguments += argumentsText;
    target.set(index, current);
  });
}

function readToolCallDeltas(chunk: unknown, target: Map<number, AgentToolCall>) {
  const root = asRecord(chunk);
  const choice = Array.isArray(root?.choices) ? asRecord(root.choices[0]) : null;
  const delta = asRecord(choice?.delta);
  const message = asRecord(choice?.message);
  mergeToolCallDeltas(target, delta?.tool_calls);
  mergeToolCallDeltas(target, message?.tool_calls);
  mergeToolCallDeltas(target, root?.tool_calls);
}

function toolResultDetail(result: unknown): string {
  const record = asRecord(result);
  if (!record) return String(result ?? "");
  if (record.denied === true) return "Execution denied";
  if (record.error) return String(record.error).slice(0, 280);
  if (Array.isArray(record.data)) return `${record.data.length} image${record.data.length === 1 ? "" : "s"} returned`;
  if (typeof record.output === "string") return record.output.slice(0, 280);
  if (typeof record.body === "string") return record.body.slice(0, 280);
  if (record.summary && typeof record.summary === "object") {
    try { return JSON.stringify(record.summary).slice(0, 280); } catch {              }
  }
  try { return JSON.stringify(record).slice(0, 280); } catch { return "Tool completed"; }
}

const AgentActivityView = memo(function AgentActivityView({ activities }: { activities?: AgentToolActivity[] }) {
  if (!activities?.length) return null;
  const iconFor = (activity: AgentToolActivity) => {
    if (activity.status === "error") return <AlertCircle className="size-3.5 text-destructive" aria-hidden="true" />;
    if (activity.status === "denied") return <LockKeyhole className="size-3.5 text-amber-300" aria-hidden="true" />;
    if (activity.name === "web_search" || activity.name === "curl") return <Globe2 className="size-3.5 text-sky-300" aria-hidden="true" />;
    if (activity.name === "generate_image") return <ImageIcon className="size-3.5 text-fuchsia-300" aria-hidden="true" />;
    if (activity.name === "execute_javascript" || activity.name === "read_workspace") return <Terminal className="size-3.5 text-emerald-300" aria-hidden="true" />;
    return <CheckCircle2 className="size-3.5 text-emerald-300" aria-hidden="true" />;
  };
  const statusLabel = (status: AgentToolActivity["status"]) => status === "running" ? "Running" : status === "done" ? "Done" : status === "denied" ? "Denied" : "Failed";
  return (
    <div className="mb-2 space-y-1.5" aria-label="Sway Router Assistant activity">
      {activities.map((activity) => {
        const images = activity.name === "generate_image" && asRecord(activity.result)?.data;
        const imageSources = Array.isArray(images) ? images.flatMap((item) => {
          const image = asRecord(item);
          if (asString(image?.url)) return [asString(image?.url)];
          if (asString(image?.b64_json)) return [`data:image/png;base64,${asString(image?.b64_json)}`];
          return [];
        }) : [];
        return (
          <div key={activity.id} className="rounded-lg border border-border/70 bg-surface/45 px-2.5 py-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {activity.status === "running" ? <span className="size-3.5 animate-pulse rounded-full border border-primary/70 motion-reduce:animate-none" aria-hidden="true" /> : iconFor(activity)}
              <span className="font-medium text-foreground/85">{activity.label}</span>
              <span className="ml-auto opacity-70">{statusLabel(activity.status)}</span>
            </div>
            {activity.detail ? <div className="mt-1 break-words text-muted-foreground/80">{activity.detail}</div> : null}
            {imageSources.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {imageSources.map((src, index) => <img key={`${activity.id}-${index}`} src={src} alt="Generated by Sway Router Assistant" className="max-h-64 max-w-full rounded-lg border border-border object-contain" />)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

type CodeTokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "function" | "property" | "constant" | "operator" | "punctuation" | "command" | "variable" | "flag";

const CODE_TOKEN_CLASSES: Record<CodeTokenKind, string> = {

  plain: "text-[#d4d4d4]",
  comment: "text-[#6a9955] italic",
  string: "text-[#ce9178]",
  number: "text-[#b5cea8]",
  keyword: "text-[#c586c0]",
  function: "text-[#dcdcaa]",
  property: "text-[#9cdcfe]",
  constant: "text-[#569cd6]",
  operator: "text-[#d4d4d4]",
  punctuation: "text-[#808080]",
  command: "text-[#dcdcaa]",
  variable: "text-[#9cdcfe]",
  flag: "text-[#c586c0]",
};

const CODE_KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function", "if", "import", "in", "interface", "implements", "lambda", "let", "new", "of", "package", "pass", "private", "public", "raise", "return", "static", "switch", "throw", "try", "type", "typeof", "var", "void", "while", "with", "yield",
]);
const CODE_CONSTANTS = new Set(["false", "null", "none", "nil", "true", "undefined", "NaN", "True", "False", "None"]);

function languageFamily(language: string) {
  const normalized = language.toLowerCase().replace(/^language-/, "");
  const shell = ["bash", "console", "powershell", "ps", "ps1", "sh", "shell", "zsh"].includes(normalized);
  const hashComments = shell || ["dockerfile", "py", "python", "rb", "ruby", "yaml", "yml"].includes(normalized);
  return { normalized, shell, hashComments };
}

function highlightCodeLine(line: string, language: string): Array<{ text: string; kind: CodeTokenKind }> {
  const { shell, hashComments } = languageFamily(language);
  const tokens: Array<{ text: string; kind: CodeTokenKind }> = [];
  let i = 0;
  let lineStart = true;
  const push = (text: string, kind: CodeTokenKind = "plain") => {
    if (text) tokens.push({ text, kind });
  };
  while (i < line.length) {
    const rest = line.slice(i);
    if (/\s/.test(line[i])) {
      const match = /^\s+/.exec(rest);
      const text = match?.[0] || line[i];
      push(text);
      lineStart = lineStart && /^\s+$/.test(text);
      i += text.length;
      continue;
    }
    if (rest.startsWith("//") || rest.startsWith("/*") || (hashComments && rest.startsWith("#"))) {
      push(rest, "comment");
      break;
    }
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let end = i + 1;
      while (end < line.length) {
        if (line[end] === "\\") { end += 2; continue; }
        if (line[end] === quote) { end += 1; break; }
        end += 1;
      }
      push(line.slice(i, end), "string");
      lineStart = false;
      i = end;
      continue;
    }
    if (shell) {
      const variable = /^\$(?:\{[A-Za-z_][\w]*\}|[A-Za-z_][\w]*)/.exec(rest);
      if (variable) {
        push(variable[0], "variable");
        lineStart = false;
        i += variable[0].length;
        continue;
      }
      const flag = /^--?[A-Za-z][\w-]*/.exec(rest);
      if (flag) {
        push(flag[0], "flag");
        lineStart = false;
        i += flag[0].length;
        continue;
      }
    }
    const number = /^\b(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/i.exec(rest);
    if (number) {
      push(number[0], "number");
      lineStart = false;
      i += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_$][\w$-]*/.exec(rest);
    if (identifier) {
      const word = identifier[0];
      const after = line.slice(i + word.length).replace(/^\s+/, "");
      const kind: CodeTokenKind = shell && lineStart
        ? "command"
        : CODE_CONSTANTS.has(word)
          ? "constant"
          : CODE_KEYWORDS.has(word)
            ? "keyword"
            : after.startsWith("(")
              ? "function"
              : after.startsWith(":")
                ? "property"
                : "plain";
      push(word, kind);
      lineStart = false;
      i += word.length;
      continue;
    }
    const operator = /^[=!<>+\-*/%&|^~?:]+/.exec(rest);
    if (operator) {
      push(operator[0], "operator");
      lineStart = false;
      i += operator[0].length;
      continue;
    }
    push(line[i], /[()[\]{},.;]/.test(line[i]) ? "punctuation" : "plain");
    lineStart = false;
    i += 1;
  }
  return tokens;
}

function codeLanguageLabel(language: string) {
  const normalized = language.toLowerCase().replace(/^language-/, "");
  const labels: Record<string, string> = { js: "JavaScript", jsx: "JSX", ts: "TypeScript", tsx: "TSX", py: "Python", sh: "Shell", bash: "Bash", ps1: "PowerShell", json: "JSON", yaml: "YAML", yml: "YAML", md: "Markdown", css: "CSS", html: "HTML" };
  return labels[normalized] || normalized || "Code";
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, "").split("\n");
  const lineDigits = String(lines.length).length;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {

    }
  }
  return (
    <div className="my-3 min-w-0 max-w-full overflow-hidden rounded-xl border border-[#2d2d30] bg-[#1e1e1e]">
      <div className="flex items-center justify-between border-b border-[#2d2d30] bg-[#181818] px-3 py-1.5 text-[10px] text-[#858585]">
        <span className="font-mono uppercase tracking-wide">{codeLanguageLabel(language)}</span>
        <Tooltip label={copied ? "Copied" : "Copy code"}>
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.08] hover:text-[#d4d4d4]" aria-label="Copy code">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </Tooltip>
      </div>
      <pre className="min-w-0 max-w-full overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-[#d4d4d4]"><code>{lines.map((line, lineIndex) => (
        <span key={lineIndex} className="block min-h-[1.5em]">
          <span className="mr-4 inline-block select-none text-right text-[#858585]" style={{ width: `${lineDigits}ch` }}>{lineIndex + 1}</span>
          {highlightCodeLine(line, language).map((token, tokenIndex) => <span key={`${lineIndex}-${tokenIndex}`} className={CODE_TOKEN_CLASSES[token.kind]}>{token.text}</span>)}
        </span>
      ))}</code></pre>
    </div>
  );
}

function closeOpenMarkdownFence(content: string) {
  const lines = content.split(/\r?\n/);
  let openFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;

    const markerText = match[1];
    const marker = markerText[0] as "`" | "~";
    const suffix = match[2].trim();
    if (!openFence) {
      openFence = { marker, length: markerText.length };
      continue;
    }

    if (marker === openFence.marker && suffix === "" && markerText.length >= openFence.length) {
      openFence = null;
    }
  }

  if (!openFence) return content;
  return `${content}${content.endsWith("\n") ? "" : "\n"}${openFence.marker.repeat(openFence.length)}`;
}

const MarkdownView = memo(function MarkdownView({ content, streaming = false }: { content: string; streaming?: boolean }) {

  const renderContent = streaming ? closeOpenMarkdownFence(content) : content;

  return (
    <div className={cn("prose-chat min-w-0 max-w-full", streaming && "prose-chat-streaming")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !/language-/.test(className || "");
            if (isInline) return <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em]" {...props}>{children}</code>;
            return <code className={cn("font-mono", className)} {...props}>{children}</code>;
          },
          pre({ children }) {

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const child: any = Array.isArray(children) ? children[0] : children;
            const className: string = child?.props?.className || "";
            const langMatch = /language-([\w-]+)/.exec(className);
            const code = String(child?.props?.children ?? "");
            return <CodeBlock code={code} language={langMatch?.[1] || ""} />;
          },
        }}
      >
        {renderContent || ""}
      </ReactMarkdown>
    </div>
  );
});

export default function SwayChat() {
  const navigate = useNavigate();
  const [workspace] = useState(() => {
    try {
      return parseSwayChatWorkspace(window.localStorage.getItem(SWAY_CHAT_WORKSPACE_STORAGE));
    } catch {
      return null;
    }
  });
  const [model, setModel] = useState(workspace?.model || "");
  const systemPrompt = buildModelAwareSystemPrompt(DEFAULT_SYSTEM_PROMPT, model);
  const [messages, setMessages] = useState<ChatMessage[]>(workspace?.messages || []);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const skipNextSaveRef = useRef(false);
  const modelUserChangedRef = useRef(false);
  const [keyGate, setKeyGate] = useState<"checking" | "ready" | "blocked">("checking");

  const modelsQ = useQuery({
    queryKey: ["sway-chat", "models"],
    queryFn: fetchChatModels,
    enabled: probeEnabled() && keyGate !== "checking",
    staleTime: 0,
    refetchOnMount: "always",
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
  });
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    if (!modelsQ.data) return;
    setModels(modelsQ.data);
    if (!modelsQ.data.length) {
      setModel("");
      return;
    }

    let storedModel = "";
    try {
      storedModel = window.localStorage.getItem(LAST_MODEL_STORAGE) || "";
    } catch {

    }
    if (modelUserChangedRef.current) return;
    const nextModel = reconcileSwayChatModel(model || storedModel, modelsQ.data);
    setModel(nextModel);
  }, [modelsQ.data, model]);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(() => new Set());
  const toggleThinking = useCallback((id: string) => setExpandedThinking((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const [isSending, setIsSending] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const [pendingApproval, setPendingApproval] = useState<AgentApprovalRequest | null>(null);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pickerRootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const transcriptViewportRef = useRef<HTMLDivElement>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const skipNextAutoScrollRef = useRef(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    saveTimerRef.current = window.setTimeout(() => {
      const raw = serializeSwayChatWorkspace({ model, systemPrompt, messages });
      if (raw) {
        try { window.localStorage.setItem(SWAY_CHAT_WORKSPACE_STORAGE, raw); } catch {                                     }
      }
      saveTimerRef.current = null;
    }, 700);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [messages, model, systemPrompt]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      approvalResolverRef.current?.(false);
      approvalResolverRef.current = null;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let requireApiKey = false;
      try {
        const s = await fetchSettings();
        if (cancelled) return;
        setSettings(s);
        requireApiKey = Boolean(s.requireApiKey);

        const secret = await getActiveGatewayApiKey().catch(() => "");
        if (cancelled) return;
        if (secret) {
          setApiKey(secret);
          setKeyGate("ready");
        } else setKeyGate(requireApiKey ? "blocked" : "ready");
      } catch { if (!cancelled) setKeyGate(requireApiKey ? "blocked" : "ready"); }
    })();
    return () => { cancelled = true; };
  }, []);

  const scrollTranscriptToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = transcriptViewportRef.current;
    if (!viewport) return;
    const latestTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (behavior === "auto") {
      if (Math.abs(viewport.scrollTop - latestTop) > 1) viewport.scrollTop = latestTop;
    } else {
      viewport.scrollTo({ top: latestTop, behavior });
    }
  }, []);

  useEffect(() => {
    if (!isNearBottom) return;
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (autoScrollFrameRef.current !== null) window.cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      scrollTranscriptToLatest();
    });
    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [messages, inlineError, isNearBottom, scrollTranscriptToLatest]);

  const handleTranscriptScroll = useCallback(() => {
    const viewport = transcriptViewportRef.current;
    if (!viewport) return;
    const nextIsNearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96;
    setIsNearBottom((previous) => previous === nextIsNearBottom ? previous : nextIsNearBottom);
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    function onDoc(e: MouseEvent) { if (pickerRootRef.current && !pickerRootRef.current.contains(e.target as Node)) setModelMenuOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setModelMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [modelMenuOpen]);
  useEffect(() => { if (modelMenuOpen) { setModelQuery(""); requestAnimationFrame(() => searchRef.current?.focus()); } }, [modelMenuOpen]);

  const catalog = useMemo(() => {
    if (models.some((m) => m.id === model)) return models;
    if (!model) return models;
    const parts = model.split("/");
    return [...models, { id: model, name: parts[parts.length - 1] || model, provider: model.includes("/") ? parts[0] : "other" }];
  }, [models, model]);
  const activeModel = useMemo(() => catalog.find((m) => m.id === model), [catalog, model]);
  const groups = useMemo(
    () => groupModels(catalog.filter((m) => m.id !== model), modelQuery),
    [catalog, model, modelQuery],
  );
  const canSend = !isSending && !!model && (draft.trim().length > 0 || attachments.length > 0);

  function updateMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function autoGrow(el: HTMLTextAreaElement) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }

  const requestAgentApproval = useCallback((request: AgentApprovalRequest) => new Promise<boolean>((resolve) => {
    approvalResolverRef.current?.(false);
    approvalResolverRef.current = resolve;
    setPendingApproval(request);
  }), []);

  function resolveAgentApproval(approved: boolean) {
    approvalResolverRef.current?.(approved);
    approvalResolverRef.current = null;
    setPendingApproval(null);
  }

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    if (activeModel?.capabilities?.vision === false) {
      toast.error("The selected model does not support image input. Choose a vision-capable model first.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const files = Array.from(list);
    if (attachments.length + files.length > MAX_IMAGES_PER_MSG) {
      toast.error(`Max ${MAX_IMAGES_PER_MSG} images per message`);
      return;
    }
    const next: Attachment[] = [];
    let payloadBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
    for (const f of files) {
      if (!isAcceptedImage(f)) {
        toast.error(`"${f.name}" must be an image ≤ 2MB`);
        continue;
      }
      if (payloadBytes + f.size > MAX_IMAGE_PAYLOAD_BYTES) {
        toast.error(`Images in one message must stay under 4MB total`);
        continue;
      }
      const url = await fileToDataURL(f);
      next.push({ id: createId(), name: f.name, size: f.size, url, mime: f.type });
      payloadBytes += f.size;
    }
    setAttachments((p) => [...p, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removeAttachment(id: string) { setAttachments((p) => p.filter((a) => a.id !== id)); }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void addFiles(imageFiles);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) void sendMessage(); }
  }
  function handleStop() { abortRef.current?.abort(); }

  function clearConversation() {
    abortRef.current?.abort();
    resolveAgentApproval(false);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    skipNextSaveRef.current = true;
    try { window.localStorage.removeItem(SWAY_CHAT_WORKSPACE_STORAGE); } catch {                               }
    setMessages([]);
    setInlineError("");
    setClearConfirmOpen(false);
  }

  function pickModel(id: string) {
    modelUserChangedRef.current = true;
    setModel(id);
    try {
      window.localStorage.setItem(LAST_MODEL_STORAGE, id);
    } catch {

    }
    setModelMenuOpen(false);
  }

  async function streamReply(
    history: ChatMessage[],
    assistant: ChatMessage,
    sys: string,
    mdl: string,
    signal?: AbortSignal,
    continuation: Array<Record<string, unknown>> = [],
    enableTools = true,
  ): Promise<StreamReplyResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const requestMessages = buildRequestMessages(history, sys, continuation);
    const requestBody: Record<string, unknown> = {
      model: mdl,
      messages: requestMessages,
      stream: true,

      stream_options: { include_usage: true },
    };
    if (enableTools) {
      requestBody.tools = SWAY_AGENT_TOOLS;
      requestBody.tool_choice = "auto";
    }
    const serializedBody = JSON.stringify(requestBody);
    if (estimateJsonBytes(serializedBody) > MAX_CHAT_REQUEST_BYTES) {
      throw new Error("Chat context is too large for the gateway. Remove older images or start a new conversation.");
    }
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers,
      body: serializedBody,
      signal: signal ?? abortRef.current?.signal,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } | string; message?: string } | null;
      throw new Error(textValue(data?.error ?? data?.message) || `Request failed (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Streaming is not supported by this browser");
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantText = "";
    let thinkingText = "";
    let ttfbMs: number | undefined;
    let thoughtMs: number | undefined;
    let contentStarted = false;
    let sawDone = false;
    let sawTerminal = false;
    const toolCallMap = new Map<number, AgentToolCall>();
    let streamUsage: import("@/lib/chatStudio").StreamUsage | undefined;
    let emitTimer: number | null = null;
    let streamUiDisposed = false;
    const requestStart = Date.now();
    const styleAt = (at: number) => Date.now() - at;

    const emit = () => {
      const patch: Partial<ChatMessage> = { content: assistantText };
      if (thinkingText) patch.thinking = thinkingText;
      if (streamUsage) patch.streamUsage = streamUsage;
      if (ttfbMs != null) patch.ttfbMs = ttfbMs;
      if (thoughtMs != null) patch.thoughtMs = thoughtMs;
      updateMessage(assistant.id, patch);
    };
    const flushEmit = () => {
      if (emitTimer !== null) {
        window.clearTimeout(emitTimer);
        emitTimer = null;
      }
      if (!streamUiDisposed) emit();
    };
    const scheduleEmit = () => {
      if (emitTimer !== null || streamUiDisposed) return;
      emitTimer = window.setTimeout(() => {
        emitTimer = null;
        if (!streamUiDisposed) emit();
      }, 50);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) flushEmit();
    };
    const disposeStreamUi = () => {
      streamUiDisposed = true;
      if (emitTimer !== null) {
        window.clearTimeout(emitTimer);
        emitTimer = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const isTerminalChunk = (chunk: unknown): boolean => {
      if (!chunk || typeof chunk !== "object") return false;
      const value = chunk as Record<string, any>;
      if (Array.isArray(value.choices) && value.choices.some((choice) => choice && choice.finish_reason != null)) return true;
      if (Array.isArray(value.candidates) && value.candidates.some((candidate) => candidate && (candidate.finishReason != null || candidate.finish_reason != null))) return true;
      if (value.delta?.stop_reason != null || value.stop_reason != null) return true;
      return ["message_stop", "response.completed", "response.failed", "response.incomplete"].includes(String(value.type || ""));
    };

    const eventData: string[] = [];
    const processEvent = (dataLines: string[]) => {
      const payload = dataLines.join("\n").trim();
      if (!payload) return;
      if (payload === "[DONE]") {
        sawDone = true;
        sawTerminal = true;
        return;
      }
      let chunk: unknown;
      try { chunk = JSON.parse(payload); } catch { return; }
      if (chunk && typeof chunk === "object" && "error" in chunk) throw new Error(textValue((chunk as { error?: unknown }).error));
      if (isTerminalChunk(chunk)) sawTerminal = true;
      readToolCallDeltas(chunk, toolCallMap);

      const usage = readStreamUsage(chunk);
      if (usage) streamUsage = {
        prompt: usage.prompt ?? streamUsage?.prompt,
        completion: usage.completion ?? streamUsage?.completion,
        reasoning: usage.reasoning ?? streamUsage?.reasoning,
        cached: usage.cached ?? streamUsage?.cached,
        cacheCreation: usage.cacheCreation ?? streamUsage?.cacheCreation,
      };

      const think = readAssistantThinking(chunk);
      if (think) thinkingText += think;

      const piece = readAssistantText(chunk);
      if (piece) {
        assistantText += piece;
        if (!contentStarted) {
          contentStarted = true;
          ttfbMs = styleAt(requestStart);
          if (thinkingText) thoughtMs = ttfbMs;
        }
      }
      if (piece || think || usage) scheduleEmit();
    };

    const processBuffer = (flush = false) => {
      const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = normalized.split("\n");
      if (flush) buffer = "";
      else buffer = lines.pop() || "";
      for (const raw of lines) {
        if (raw === "") {
          if (eventData.length) {
            processEvent(eventData);
            eventData.length = 0;
          }
          continue;
        }
        if (raw.startsWith(":")) continue;
        if (raw.startsWith("data:")) eventData.push(raw.startsWith("data: ") ? raw.slice(6) : raw.slice(5));
      }
      if (flush && eventData.length) {
        processEvent(eventData);
        eventData.length = 0;
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          processBuffer(true);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }
    } catch (error) {
      disposeStreamUi();
      throw error;
    }
    flushEmit();
    if (!sawDone && !sawTerminal) {
      disposeStreamUi();
      throw new Error("Stream ended before a terminal response event");
    }
    const toolCalls = [...toolCallMap.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({
        ...call,
        id: call.id || `call_${toolCallMap.size}`,
        function: { name: call.function.name, arguments: call.function.arguments },
      }))
      .filter((call) => call.function.name);
    const previousContent = assistant.content && assistant.content !== "No content returned." ? assistant.content : "";
    const combinedContent = [previousContent, assistantText].filter(Boolean).join(previousContent && assistantText ? "\n\n" : "");
    const commonPatch: Partial<ChatMessage> = { content: combinedContent, thinking: thinkingText || undefined, streamUsage, ttfbMs: ttfbMs ?? undefined, thoughtMs: thinkingText || (streamUsage?.reasoning ?? 0) > 0 ? (thoughtMs ?? styleAt(requestStart)) : undefined };
    if (toolCalls.length > 0) {
      commonPatch.status = "streaming";
      disposeStreamUi();
      updateMessage(assistant.id, commonPatch);
      return { message: { ...assistant, ...commonPatch, content: combinedContent }, toolCalls, assistantContent: assistantText };
    }
    const visibleContent = combinedContent || "No content returned.";
    const finalPatch: Partial<ChatMessage> = { ...commonPatch, content: visibleContent, durationMs: normalizeChatDuration(styleAt(requestStart)), status: "done" };
    const completed: ChatMessage = { ...assistant, ...finalPatch, content: visibleContent };
    disposeStreamUi();
    updateMessage(assistant.id, finalPatch);
    return { message: completed, toolCalls: [], assistantContent: assistantText };
  }

  function modelContextWindow(mdl: string): number {
    const id = (mdl || "").toLowerCase();
    if (/1m|long|128k|200k|400k|1m/.test(id)) return 128_000;
    if (/gpt-5|max|o1|o3|gemini/.test(id)) return 128_000;
    if (/4o|4\.1|sonnet|opus|fable|haiku/.test(id)) return 128_000;
    return 32_000;
  }
  function maybeCompact(next: ChatMessage[]): ChatMessage[] {
    const max = modelContextWindow(model);
    if (!shouldCompact(next, systemPrompt, max)) return next;
    const compacted = compactHistory(next, systemPrompt, max);
    if (compacted === next) return next;
    toast.info("Context auto-compacted (older turns trimmed).");
    return compacted;
  }

  async function runAssistantTurn(
    history: ChatMessage[],
    assistant: ChatMessage,
    sys: string,
    mdl: string,
    signal: AbortSignal,
  ) {
    const modelInfo = catalog.find((item) => item.id === mdl);
    const modelSupportsTools = modelInfo?.capabilities?.tools !== false;
    const activities: AgentToolActivity[] = [];
    let continuation: Array<Record<string, unknown>> = [];
    let currentAssistant = assistant;
    let toolsEnabled = modelSupportsTools;
    const maxToolRounds = 6;
    const maxToolCalls = 12;
    let executedToolCalls = 0;

    const publishActivities = () => updateMessage(assistant.id, { toolActivity: [...activities] });
    const setActivity = (id: string, patch: Partial<AgentToolActivity>) => {
      const index = activities.findIndex((item) => item.id === id);
      if (index < 0) return;
      activities[index] = { ...activities[index], ...patch };
      publishActivities();
    };

    for (let round = 0; round < maxToolRounds; round += 1) {
      let result: StreamReplyResult;
      try {
        result = await streamReply(history, currentAssistant, sys, mdl, signal, continuation, toolsEnabled);
      } catch (error) {

        const message = error instanceof Error ? error.message.toLowerCase() : "";
        const looksLikeUnsupportedTools = toolsEnabled && /tool|function|unsupported|not support|unknown field|invalid parameter/.test(message);
        if (!looksLikeUnsupportedTools) throw error;
        toolsEnabled = false;
        result = await streamReply(history, currentAssistant, sys, mdl, signal, continuation, false);
      }
      currentAssistant = result.message;
      if (!result.toolCalls.length) return;

      const remaining = maxToolCalls - executedToolCalls;
      const toolCalls = result.toolCalls.slice(0, Math.max(0, remaining));
      if (!toolCalls.length) {
        updateMessage(assistant.id, { content: currentAssistant.content || "I stopped before running more tools because the tool-call budget was reached.", status: "done" });
        return;
      }

      const assistantToolCalls = toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.function.name, arguments: call.function.arguments },
      }));
      const toolMessages: Array<Record<string, unknown>> = [];
      for (const call of toolCalls) {
        executedToolCalls += 1;
        const activity: AgentToolActivity = { id: call.id, name: call.function.name, label: agentToolLabel(call.function.name), status: "running" };
        activities.push(activity);
        publishActivities();
        let toolResult: Record<string, unknown>;
        try {
          let args: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(call.function.arguments || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
            else throw new Error("Tool arguments must be a JSON object");
          } catch (error) {
            throw new Error(`Invalid arguments for ${call.function.name}: ${error instanceof Error ? error.message : "expected JSON object"}`);
          }
          toolResult = await executeSwayTool(call.function.name, args, { apiKey, approve: requestAgentApproval });
          setActivity(call.id, { status: toolResult.denied === true ? "denied" : toolResult.ok === false ? "error" : "done", detail: toolResultDetail(toolResult), result: toolResult });
        } catch (error) {
          toolResult = { ok: false, error: error instanceof Error ? error.message : "Tool failed" };
          setActivity(call.id, { status: "error", detail: toolResult.error as string, result: toolResult });
        }
        toolMessages.push({ role: "tool", tool_call_id: call.id, content: compactToolResult(toolResult) });
      }
      continuation = [...continuation, { role: "assistant", content: result.assistantContent || null, tool_calls: assistantToolCalls }, ...toolMessages];
      currentAssistant = { ...currentAssistant, toolActivity: [...activities] };
    }

    updateMessage(assistant.id, { content: currentAssistant.content || "I stopped after several tool steps without a final response.", status: "done" });
  }

  async function sendMessage() {
    if (isSending) return;
    if (!model) { toast.error("Select a model first"); return; }
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    if (keyGate === "blocked") { navigate(API_KEYS_ROUTE); return; }
    if (settings?.requireApiKey && !apiKey.trim()) { toast.error("Add a gateway API key first"); return; }

    const userMsg: ChatMessage = { id: createId(), role: "user", content: text, attachments: attachments.length ? attachments : undefined };
    const startAt = Date.now();
    const assistantMsg: ChatMessage = { id: createId(), role: "assistant", content: "", status: "streaming", model, startAt };

    let history: ChatMessage[];
    if (editing) {
      const idx = messages.findIndex((m) => m.id === editing);
      if (idx >= 0) {
        const edited = { ...userMsg, id: editing };
        history = [...messages.slice(0, idx), edited];
      } else {
        history = [...messages, userMsg];
      }
      setEditing(null);
    } else {
      history = [...messages, userMsg];
    }
    history = maybeCompact(history);
    setMessages([...history, assistantMsg]);
    setDraft(""); setAttachments([]); setInlineError("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    setIsSending(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await runAssistantTurn(history, assistantMsg, systemPrompt, model, controller.signal);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") { updateMessage(assistantMsg.id, { status: "stopped" }); toast.info("Streaming stopped"); }
      else { const msg = getErrorMessage(err, "Failed to send message"); updateMessage(assistantMsg.id, { status: "error" }); setInlineError(msg); toast.error(msg); }
    } finally {
      updateMessage(assistantMsg.id, { durationMs: normalizeChatDuration(Date.now() - (assistantMsg.startAt || startAt)) });

      if (abortRef.current !== controller) return;
      setIsSending(false);
      abortRef.current = null;
      setMessages((prev) => maybeCompact(prev));
    }
  }

  function editMessage(id: string) {
    const m = messages.find((x) => x.id === id);
    if (!m || m.role !== "user") return;
    setEditing(id);
    setDraft(m.content);
    if (m.attachments) setAttachments(m.attachments); else setAttachments([]);
    composerRef.current?.focus();
  }
  function deleteMessage(id: string) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, deleted: true } : m)));
  }
  async function retryFrom(userMsgId: string) {
    if (isSending) return;
    const idx = messages.findIndex((m) => m.id === userMsgId);
    if (idx < 0) return;
    const userMsg = messages[idx];
    if (userMsg.role !== "user") return;

    const assistantMsg: ChatMessage = { id: createId(), role: "assistant", content: "", status: "streaming", model, startAt: Date.now() };
    const history = messages.slice(0, idx + 1).filter((m) => !m.deleted);
    const compactedHistory = maybeCompact(history);
    setMessages([...compactedHistory, assistantMsg]);
    setDraft(""); setInlineError(""); setIsSending(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try { await runAssistantTurn(compactedHistory, assistantMsg, systemPrompt, model, controller.signal); }
    catch (err) {
      if (err instanceof Error && err.name === "AbortError") { updateMessage(assistantMsg.id, { status: "stopped" }); toast.info("Streaming stopped"); }
      else { const msg = getErrorMessage(err, "Failed to send message"); updateMessage(assistantMsg.id, { status: "error" }); setInlineError(msg); toast.error(msg); }
    } finally {
      updateMessage(assistantMsg.id, { durationMs: normalizeChatDuration(Date.now() - (assistantMsg.startAt || Date.now())) });

      if (abortRef.current !== controller) return;
      setIsSending(false);
      abortRef.current = null;
      setMessages((prev) => maybeCompact(prev));
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full max-w-full overflow-x-hidden pb-2">
      <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col gap-0">
        <Header
          title="Sway Chat"
          className="mb-0 min-w-0 shrink-0 flex-row items-center justify-between gap-2 pb-2 sm:mb-0 sm:pb-3"
          actions={
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip label="Clear conversation">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={messages.length === 0}
                  aria-label="Clear conversation"
                  className="size-8 px-0 sm:h-7 sm:w-auto sm:px-2.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              </Tooltip>
            </div>
          }
        />

        {modelsQ.isError ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{getErrorMessage(modelsQ.error, "Unable to load live models. Check your session and provider connections.")}</span>
            <button type="button" onClick={() => void modelsQ.refetch()} className="shrink-0 rounded-md border border-destructive/30 px-2 py-1 font-medium hover:bg-destructive/10" aria-label="Retry loading models">Retry</button>
          </div>
        ) : null}

        <Frame className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-xl bg-transparent p-0 sm:rounded-2xl sm:bg-muted/72 sm:p-1">
          <FramePanel className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border-border/80 p-0 sm:rounded-xl">
            <ScrollArea viewportRef={transcriptViewportRef} onScroll={handleTranscriptScroll} overscrollContain scrollbarGutter className="min-h-0 min-w-0 w-full max-w-full flex-1">
              <div className="w-full min-w-0 max-w-full px-2.5 py-3 sm:px-5 sm:py-4">
                {!isNearBottom && messages.length > 0 ? (
                  <button type="button" onClick={() => { skipNextAutoScrollRef.current = true; setIsNearBottom(true); scrollTranscriptToLatest("smooth"); }} className="sticky top-2 z-20 mx-auto mb-3 flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur transition-colors hover:text-foreground" aria-label="Jump to latest message">
                    <ChevronDown className="size-3.5" /> New messages
                  </button>
                ) : null}
                {inlineError ? (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 break-words">{inlineError}</span>
                    <button type="button" onClick={() => setInlineError("")} className="shrink-0 text-destructive/70 hover:text-destructive" aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : null}

                {pendingApproval ? (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.06] p-3" role="dialog" aria-label="Approve JavaScript execution">
                    <div className="flex items-start gap-2">
                      <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground">Approve local JavaScript execution?</p>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Sway Router Assistant requested a diagnostic script. It runs locally with a reduced environment and a 10-second timeout.</p>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border/70 bg-background/70 p-2 font-mono text-[11px] leading-5 text-foreground/90"><code>{pendingApproval.code}</code></pre>
                        <div className="mt-2 flex justify-end gap-1.5">
                          <Button type="button" variant="outline" size="sm" onClick={() => resolveAgentApproval(false)} className="h-7 px-2.5 text-[11px]">Deny</Button>
                          <Button type="button" size="sm" onClick={() => resolveAgentApproval(true)} className="h-7 px-2.5 text-[11px]">Approve & run</Button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : null}

                {messages.length === 0 ? (
                  <div className="flex h-full min-h-[30vh] flex-col items-center justify-center gap-2 px-6 text-center">
                    <span className="grid size-12 place-items-center rounded-xl border border-border bg-surface text-muted-foreground">
                      <img src="/logo/swaychat.svg" alt="" width="24" height="24" className="size-6 object-contain" />
                    </span>
                    <div className="space-y-1"><h2 className="text-sm font-semibold">Sway Chat</h2><p className="mx-auto max-w-md text-xs leading-5 text-muted-foreground">Pick a model, drop a prompt.</p></div>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {messages.map((m) => {
                      if (m.deleted) return null;
                      if (m.role === "user") {
                        return (
                          <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="group mb-3 flex justify-end">
                            <div className="max-w-[calc(100%-0.25rem)] text-left sm:max-w-[min(88%,36rem)]">
                               {m.content ? <div className="rounded-2xl rounded-br-md border border-primary/80 bg-primary px-3 py-2 text-[13px] leading-5 text-primary-foreground sm:text-sm sm:leading-6">
                                 <div className="whitespace-pre-wrap break-words">{m.content}</div>
                               </div> : null}
                              {m.attachments && m.attachments.length > 0 ? (
                                <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                                  {m.attachments.map((a) => (<img key={a.id} src={a.url} alt={a.name} className="h-16 w-16 rounded-md border border-border object-cover" />))}
                                </div>
                              ) : null}
                              <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                 <Tooltip label="Edit & resend"><button type="button" onClick={() => editMessage(m.id)} className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground" aria-label="Edit and resend message"><Pencil className="h-3 w-3" /></button></Tooltip>
                                 <Tooltip label="Retry from here"><button type="button" onClick={() => void retryFrom(m.id)} className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground" aria-label="Retry from this message"><RotateCcw className="h-3 w-3" /></button></Tooltip>
                                 <Tooltip label="Delete"><button type="button" onClick={() => deleteMessage(m.id)} className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-destructive" aria-label="Delete message"><Trash2 className="h-3 w-3" /></button></Tooltip>
                              </div>
                            </div>
                          </motion.div>
                        );
                      }
                      const isStreaming = m.status === "streaming";
                      const hasThoughtBlock = Boolean(
                        m.thinking ||
                        m.thoughtMs != null ||
                        (m.streamUsage?.reasoning ?? 0) > 0 ||
                        m.toolActivity?.length,
                      );
                      return (
                        <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: "easeOut" }} className="group mb-3 flex justify-start">
                          <div className="flex w-full max-w-full items-start sm:max-w-[min(92%,42rem)]">
                            <div className="min-w-0 flex-1 text-[13px] leading-5 sm:text-sm sm:leading-6">
                            <div className={cn("px-0.5 pb-2 pt-0.5 sm:pb-2.5", m.content && "rounded-2xl rounded-bl-md border border-border/70 bg-muted/45 px-3 py-2.5 sm:px-3.5 sm:pt-2.5")}>
                            {m.status === "error" && !m.content ? (
                              <div className="flex items-center gap-2">
                                <p className="text-destructive">Failed to get a response.</p>
                                  <Tooltip label="Retry from the last user turn"><button type="button" onClick={() => { const prev = messages[messages.indexOf(m) - 1]; if (prev && prev.role === "user") void retryFrom(prev.id); }} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-surface-hover" aria-label="Retry from the last user turn">
                                  <RotateCcw className="h-3 w-3" />Retry
                                </button></Tooltip>
                              </div>
                            ) : (
                              <>
                                {hasThoughtBlock ? <ReasoningHistory message={m} open={isStreaming || expandedThinking.has(m.id)} onToggle={() => toggleThinking(m.id)} /> : null}
                                {isStreaming && !hasThoughtBlock ? <StreamingStatus message={m} /> : null}
                                {m.content ? <MarkdownView content={m.content} streaming={isStreaming} /> : null}
                                {m.content ? (
                                  <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
                                    <Tooltip label="Copy response"><button type="button" onClick={() => { navigator.clipboard?.writeText(m.content).then(() => toast.info("Copied")).catch(() => {}); }} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-surface-hover hover:text-foreground" aria-label="Copy response"><Copy className="h-3 w-3" />Copy</button></Tooltip>
                                    {m.status === "done" ? <Tooltip label="Regenerate response"><button type="button" onClick={() => { const prev = messages[messages.indexOf(m) - 1]; if (prev?.role === "user") void retryFrom(prev.id); }} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-surface-hover hover:text-foreground" aria-label="Regenerate response"><RotateCcw className="h-3 w-3" />Retry</button></Tooltip> : isStreaming ? <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/70" role="status" aria-live="polite"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none" />Streaming</span> : null}
                                  </div>
                                ) : null}
                              </>
                            )}
                             {m.status === "stopped" ? <p className="mt-2 text-xs text-amber-400">Stopped before completion. You can retry this turn.</p> : null}
                             {m.status === "error" && m.content ? <p className="mt-2 text-xs text-destructive">Response interrupted. You can retry this turn.</p> : null}
                             {m.status === "done" ? (
                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
                                <AssistantTelemetry message={m} />
                              </div>
                            ) : null}
                            </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
              </div>
            </ScrollArea>

            <div className="w-full max-w-full shrink-0 border-t border-border bg-background/95 px-2.5 py-2.5 backdrop-blur-sm sm:bg-transparent sm:px-3">
              {attachments.length > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-[11px]">
                      <img src={a.url} alt={a.name} className="h-6 w-6 rounded object-cover" />
                      <span className="max-w-32 truncate">{a.name}</span>
                      <button type="button" onClick={() => removeAttachment(a.id)} className="grid h-4 w-4 place-items-center rounded text-muted-foreground hover:text-destructive" aria-label={`Remove ${a.name}`}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                </div>
              ) : null}
              {editing ? (
                <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
                  <RotateCcw className="h-3 w-3" />Editing a previous message — sending will replace it and drop later turns.
                   <button type="button" onClick={() => { setEditing(null); setDraft(""); }} className="ml-auto rounded p-0.5 hover:text-foreground" aria-label="Cancel editing"><X className="h-3 w-3" /></button>
                </div>
              ) : null}
              <div className="grid min-h-[5.25rem] w-full max-w-full grid-cols-[1fr_auto] grid-rows-[1fr_auto] gap-x-1.5 gap-y-1 rounded-[26px] border border-border bg-surface px-2.5 py-2 sm:flex sm:min-h-0 sm:items-end sm:gap-2 sm:rounded-lg sm:px-2 sm:py-2">
                 <textarea ref={composerRef} value={draft} onChange={(e) => { setDraft(e.target.value); autoGrow(e.currentTarget); }} onPaste={handlePaste} onKeyDown={handleKeyDown} placeholder="Ask Sway Router . . ." aria-label="Ask Sway Router" rows={1} className="col-span-2 row-start-1 max-h-32 min-h-10 w-full min-w-0 resize-none bg-transparent px-1.5 py-1.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground sm:order-2 sm:min-h-8 sm:flex-1 sm:px-1 sm:text-sm sm:leading-5" />
                <div className="col-span-2 row-start-2 flex min-w-0 items-center justify-between gap-2 sm:contents">
                  <div className="flex min-w-0 items-center gap-1 sm:order-1">
                     <Tooltip label="Attach or paste images (≤2MB each, 4MB total)"><button type="button" onClick={() => fileInputRef.current?.click()} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:rounded-md" aria-label="Attach or paste images (≤2MB each, 4MB total)"><Paperclip className="h-4 w-4" /></button></Tooltip>
                    <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" className="hidden" onChange={(e) => void addFiles(e.target.files)} />
                    <div ref={pickerRootRef} className="relative min-w-0">
                       <button type="button" onClick={() => setModelMenuOpen((o) => !o)} className={cn("flex h-8 max-w-[min(58vw,15rem)] min-w-0 items-center gap-1.5 rounded-full border border-transparent bg-background/70 px-2.5 text-left transition-colors hover:bg-surface-hover sm:w-full sm:max-w-52 sm:rounded-md sm:border-border sm:bg-card sm:px-2", modelMenuOpen && "border-white/25")} aria-label="Select a model">
                         <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{activeModel ? modelDisplayName(activeModel) : "Select a model"}</span>
                         <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", modelMenuOpen && "rotate-180")} />
                      </button>
                      <AnimatePresence>
                      {modelMenuOpen ? (
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 4 }} transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.5 }} className="absolute bottom-[calc(100%+6px)] left-0 z-40 w-[min(20rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
                          <div className="flex h-72 max-h-[min(18rem,calc(100vh-8rem))] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
                            <div className="shrink-0 border-b border-border bg-card p-1.5">
                               <div className="relative"><Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input ref={searchRef} value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder="Search models…" aria-label="Search models" className="h-8 pl-7 text-xs" /></div>
                            </div>
                            {activeModel ? (
                              <div className="shrink-0 border-b border-border bg-card px-1.5 pb-1.5">
                                <div className="px-1.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current model</div>
                                <button
                                    type="button"
                                    onClick={() => pickModel(activeModel.id)}
                                    className="flex w-full items-center gap-2 rounded-md bg-surface-hover px-2 py-1.5 text-left text-foreground transition-colors hover:bg-surface-hover/80"
                                  >
                                  <ProviderModelIcon provider={activeModel.provider} className="h-5 w-5" />
                                  <span className="min-w-0 flex-1 break-all text-[11px] font-medium leading-4">{activeModel.id}</span>
                                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                </button>
                              </div>
                            ) : null}
                            <ScrollArea overscrollContain scrollFade className="min-h-0 flex-1">
                              <div className="py-1">
                                <ProviderModelAccordion
                                  groups={groups}
                                  query={modelQuery}
                                  empty={<p className="px-3 py-4 text-center text-xs text-muted-foreground">{catalog.length === 0 ? "No providers connected yet" : modelQuery ? "No other models match" : "No other models available"}</p>}
                                  renderItem={(mm, provider) => (
                                    <button type="button" onClick={() => pickModel(mm.id)} className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-surface-hover">
                                      <ProviderModelIcon provider={provider} className="mt-0.5 h-5 w-5 shrink-0" />
                                      <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-4">{mm.id}</span>
                                    </button>
                                  )}
                                />
                              </div>
                            </ScrollArea>
                          </div>
                        </motion.div>
                      ) : null}
                      </AnimatePresence>
                    </div>
                  </div>
                  {isSending ? (
                    <button type="button" onClick={handleStop} className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:order-3 sm:rounded-md" aria-label="Stop streaming"><Square className="h-3.5 w-3.5" /></button>
                  ) : (
                    <button type="button" onClick={() => void sendMessage()} disabled={!canSend || keyGate !== "ready"} className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:order-3 sm:rounded-md", canSend && keyGate === "ready" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-surface-hover text-muted-foreground")} aria-label="Send message"><ArrowUp className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
              {keyGate === "blocked" ? <p className="mt-1.5 text-center text-[10px] text-muted-foreground">An API key is required — create one in the API Keys menu.</p> : null}
            </div>
          </FramePanel>
        </Frame>
      </div>

      <Dialog open={keyGate === "blocked"} onOpenChange={(o) => { if (!o) { setKeyGate("ready"); navigate(API_KEYS_ROUTE); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />API key required</DialogTitle>
          <DialogDescription>The gateway is set to require an API key for chat requests. Create one in the API Keys menu — it takes a few seconds and Sway Chat will use it automatically.</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => navigate(API_KEYS_ROUTE)}>Create API key</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
              Clear conversation?
            </DialogTitle>
            <DialogDescription>
              This will remove all messages from this conversation and its saved local chat history. Provider connections and Usage history will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={clearConversation}>
              Clear conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
