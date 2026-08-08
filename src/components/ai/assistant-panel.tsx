"use client";

/**
 * The assistant, available from every page.
 *
 * It is context-aware without the user having to say so: it picks up the
 * reporting period from the URL (the same `?from=&to=` the dashboard uses),
 * and when it's open inside an LCA project it talks to that project's copilot
 * instead of the group-wide assistant.
 *
 * Deliberately part of the product rather than a bolted-on chat widget: same
 * type scale, same slate palette, same card treatment as the rest of the app,
 * and every answer carries the "check this against the records" footnote.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiText } from "./ai-text";
import { AiProvenanceFootnote, AiUnavailableNotice } from "./ai-disclosure";
import { cn } from "@/lib/cn";

interface Turn {
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  usedFallback?: boolean;
}

const GROUP_SUGGESTIONS = [
  "Why did our emissions change compared with last year?",
  "Which Scope 3 category is largest this period?",
  "What information are we still missing?",
  "Explain the difference between location-based and market-based Scope 2.",
];

const LCA_SUGGESTIONS = [
  "What information am I missing in this assessment?",
  "Is my functional unit clear and measurable?",
  "Where are the hotspots, and why?",
  "Which stages have the weakest data?",
];

/** `/assessments/<id>` and its sub-routes put the copilot into that assessment's context. */
function lcaProjectIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/assessments\/([^/]+)/);
  const id = match?.[1];
  return id && id !== "new" ? id : null;
}

export interface AssistantPanelProps {
  /** Resolved on the server so the panel opens with an honest state, not after a failed call. */
  available: boolean;
  unavailableMessage: string | null;
}

export function AssistantPanel({ available, unavailableMessage }: AssistantPanelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(available ? null : unavailableMessage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [conversationKey, setConversationKey] = useState<string | null>(null);

  const projectId = lcaProjectIdFrom(pathname);
  const suggestions = projectId ? LCA_SUGGESTIONS : GROUP_SUGGESTIONS;

  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  // A different LCA project is a different conversation — carrying turns
  // across would put one study's context in front of another's.
  // Reset during render rather than in an effect: React's own recommended
  // pattern for "this state is derived from a prop that changed", and it
  // avoids the extra commit an effect-driven reset would cause.
  if (conversationKey !== projectId) {
    setConversationKey(projectId);
    setTurns([]);
    setUnavailable(available ? null : unavailableMessage);
  }

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, open, pending]);

  const history = useMemo(() => turns.map((t) => ({ role: t.role, content: t.content })), [turns]);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending || !available) return;

      setQuestion("");
      setUnavailable(null);
      setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
      setPending(true);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, from, to, projectId, history }),
        });
        const data = await response.json();

        if (data.error) {
          setUnavailable(data.error.message ?? "AI assistance is temporarily unavailable.");
          return;
        }

        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: data.answer as string, model: data.model, usedFallback: data.usedFallback },
        ]);
      } catch {
        setUnavailable("Couldn't reach the assistant. Everything else in the platform still works.");
      } finally {
        setPending(false);
      }
    },
    [from, to, history, pending, projectId, available],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the AI assistant" : "Open the AI assistant"}
        className={cn(
          "no-print fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-lg transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
          open ? "bg-slate-700 text-white hover:bg-slate-600" : "bg-slate-900 text-white hover:bg-slate-800",
        )}
      >
        {open ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        {open ? "Close" : projectId ? "LCA copilot" : "Ask AI"}
      </button>

      {open && (
        <aside
          aria-label="AI assistant"
          className="no-print fixed bottom-20 right-5 z-30 flex max-h-[min(36rem,calc(100vh-7rem))] w-[min(28rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="shrink-0 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {projectId ? "LCA copilot" : "Carbon assistant"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {projectId
                ? "Answers from this study's recorded data and results. It never calculates an LCA figure itself."
                : "Answers from your organisation's own data and this platform's methodology. It never calculates a figure itself."}
            </p>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {turns.length === 0 && available && !unavailable && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Try asking</p>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg rounded-br-sm bg-slate-900 px-3 py-2 text-sm text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  <AiText text={turn.content} />
                  <AiProvenanceFootnote model={turn.model ?? null} usedFallback={turn.usedFallback} />
                </div>
              ),
            )}

            {pending && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </p>
            )}

            {unavailable && <AiUnavailableNotice message={unavailable} />}
          </div>

          <form
            className="shrink-0 border-t border-slate-100 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <div className="flex items-end gap-2">
              <label htmlFor="ai-question" className="sr-only">
                Your question
              </label>
              <textarea
                id="ai-question"
                rows={2}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(question);
                  }
                }}
                disabled={!available}
                placeholder={available ? "Ask about your emissions data…" : "AI assistance is unavailable"}
                className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-500"
              />
              <Button type="submit" size="sm" disabled={!available || pending || question.trim().length === 0} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}
