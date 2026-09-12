import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type CodeLang =
  | "python"
  | "typescript"
  | "javascript"
  | "go"
  | "curl"
  | "bash"
  | "php"
  | "ruby"
  | "json"
  | "text";

const LANG_LABEL: Record<CodeLang, string> = {
  python: "Python",
  typescript: "TypeScript",
  javascript: "JavaScript",
  go: "Go",
  curl: "cURL",
  bash: "Shell",
  php: "PHP",
  ruby: "Ruby",
  json: "JSON",
  text: "Plain text",
};

const LANG_FILE: Partial<Record<CodeLang, string>> = {
  python: "example.py",
  typescript: "example.ts",
  javascript: "example.js",
  go: "main.go",
  curl: "request.sh",
  bash: "script.sh",
  php: "example.php",
  ruby: "example.rb",
  json: "payload.json",
};

function highlightLine(line: string, lang: CodeLang): ReactNode[] {
  if (lang === "text") return [line];

  const patterns: Array<{ re: RegExp; cls: string }> = [];

  if (lang === "python") {
    patterns.push(
      { re: /(#.*)$/g, cls: "text-zinc-500" },
      {
        re: /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(from|import|as|def|class|return|if|elif|else|for|while|with|try|except|raise|True|False|None|print|await|async|yield|lambda|pass|in|not|and|or)\b/g,
        cls: "text-violet-400",
      },
      { re: /\b(self|cls)\b/g, cls: "text-sky-400" },
      { re: /\b(\d+\.?\d*)\b/g, cls: "text-amber-400" }
    );
  } else if (lang === "typescript" || lang === "javascript") {
    patterns.push(
      { re: /(\/\/.*)$/g, cls: "text-zinc-500" },
      {
        re: /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(import|from|export|const|let|var|function|async|await|return|if|else|for|while|class|new|typeof|interface|type|extends|implements|true|false|null|undefined|of|in)\b/g,
        cls: "text-violet-400",
      },
      { re: /\b(console|OpenAI|Anthropic)\b/g, cls: "text-sky-400" },
      { re: /\b(\d+\.?\d*)\b/g, cls: "text-amber-400" }
    );
  } else if (lang === "go") {
    patterns.push(
      { re: /(\/\/.*)$/g, cls: "text-zinc-500" },
      {
        re: /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(package|import|func|return|if|else|for|range|var|const|type|struct|map|defer|go|chan|select|case|default|true|false|nil|err|error|string|int|int64|any)\b/g,
        cls: "text-violet-400",
      },
      { re: /\b(fmt|http|json|io|bytes)\b/g, cls: "text-sky-400" },
      { re: /\b(\d+\.?\d*)\b/g, cls: "text-amber-400" }
    );
  } else if (lang === "curl" || lang === "bash") {
    patterns.push(
      { re: /(#.*)$/g, cls: "text-zinc-500" },
      {
        re: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(curl|echo|export|cd|npm|pip|go|php|ruby)\b/g,
        cls: "text-violet-400",
      },
      {
        re: /(^|\s)(-[A-Za-z][A-Za-z0-9-]*)\b/g,
        cls: "text-sky-400",
      }
    );
  } else if (lang === "php") {
    patterns.push(
      { re: /(\/\/.*|#.*)$/g, cls: "text-zinc-500" },
      {
        re: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(function|return|echo|true|false|null|array|new|class|public|private|protected|use|namespace|if|else|foreach|as)\b/g,
        cls: "text-violet-400",
      },
      { re: /(\$[\w]+)/g, cls: "text-sky-400" },
      { re: /\b(\d+\.?\d*)\b/g, cls: "text-amber-400" }
    );
  } else if (lang === "ruby") {
    patterns.push(
      { re: /(#.*)$/g, cls: "text-zinc-500" },
      {
        re: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(require|def|end|do|if|else|elsif|unless|class|module|return|true|false|nil|puts|print|new|each)\b/g,
        cls: "text-violet-400",
      },
      { re: /(:[\w]+)/g, cls: "text-amber-400" },
      { re: /\b(\d+\.?\d*)\b/g, cls: "text-amber-400" }
    );
  } else if (lang === "json") {
    patterns.push(
      {
        re: /("(?:\\.|[^"\\])*")(\s*:)/g,
        cls: "text-sky-400",
      },
      {
        re: /("(?:\\.|[^"\\])*")/g,
        cls: "text-emerald-400",
      },
      {
        re: /\b(true|false|null)\b/g,
        cls: "text-violet-400",
      },
      { re: /\b(-?\d+\.?\d*)\b/g, cls: "text-amber-400" }
    );
  }

  type Piece = { start: number; end: number; cls: string; text: string };
  const hits: Piece[] = [];

  for (const { re, cls } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    while ((m = r.exec(line)) !== null) {

      const full = m[0];
      let start = m.index;
      let text = full;

      if (lang === "curl" || lang === "bash") {
        const flag = m[2] ?? m[1];
        if (flag && full.indexOf(flag) >= 0 && /^-\w/.test(flag)) {
          start = m.index + full.lastIndexOf(flag);
          text = flag;
        }
      }
      const end = start + text.length;
      const overlap = hits.some((h) => !(end <= h.start || start >= h.end));
      if (!overlap && text.length) {
        hits.push({ start, end, cls, text });
      }
    }
  }

  hits.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  hits.forEach((h, i) => {
    if (h.start > cursor) {
      nodes.push(line.slice(cursor, h.start));
    }
    nodes.push(
      <span key={`${i}-${h.start}`} className={h.cls}>
        {h.text}
      </span>
    );
    cursor = h.end;
  });
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes.length ? nodes : [line];
}

export function CodeBlock({
  code,
  language = "text",
  filename,
  className,
  showLineNumbers = true,
}: {
  code: string;
  language?: CodeLang;
  filename?: string;
  className?: string;
  showLineNumbers?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);
  const title = filename ?? LANG_FILE[language] ?? LANG_LABEL[language];
  const gutterWidth = String(lines.length).length;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {

    }
  }

  return (
    <div
      className={cn(
        "group relative flex h-[min(20rem,45vh)] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-white/10",
        "bg-[#0b0d12]",
        className
      )}
    >
      <div className="relative z-10 flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-3 py-2 sm:px-3.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-border" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
          <span className="h-2 w-2 rounded-full bg-primary/70" />
        </div>
        <div className="min-w-0 flex-1 truncate text-center font-mono text-[11px] text-zinc-400 sm:text-xs">
          {title}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500 sm:inline">
            {LANG_LABEL[language]}
          </span>
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2",
              "font-mono text-[11px] text-zinc-300 transition-colors",
              "hover:bg-white/[0.08] hover:text-white",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
            )}
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-auto">
        <pre className="m-0 p-0 font-mono text-[12px] leading-[1.65] text-zinc-200 sm:text-[12.5px]">
          <code className="block min-w-full py-3">
            {lines.map((line, i) => (
              <div
                key={i}
                className="flex px-0 hover:bg-white/[0.03]"
              >
                {showLineNumbers ? (
                  <span
                    className="sticky left-0 select-none bg-[#0b0d12]/80 pl-3 pr-3 text-right text-zinc-600 backdrop-blur-[2px] sm:pl-4"
                    style={{ minWidth: `${gutterWidth + 2.5}ch` }}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                ) : (
                  <span className="w-3 shrink-0 sm:w-4" aria-hidden />
                )}
                <span className="flex-1 whitespace-pre pr-4 text-zinc-200">
                  {line.length ? highlightLine(line, language) : "\n"}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

export type { CodeLang };
