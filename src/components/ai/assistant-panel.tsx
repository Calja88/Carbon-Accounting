"use client";

/**
 * The assistant, available from every page.
 *
 * It is context-aware without the user having to say so: it picks up the
 * reporting period from the URL (the same `?from=&to=` the dashboard uses),
 * and when it's open inside an LCA project it talks to that project's copilot
 * instead of the group-wide assistant.
 *
 * It also accepts evidence. A file dragged onto the panel, chosen from the
 * picker or pasted from the clipboard is uploaded through the platform's
 * existing document endpoint — same size cap, same MIME allow-list, same
 * SourceDocument — read, and then handed to the turn as an attachment. What
 * happens next is decided on the server: this component never decides that
 * something should be logged, and never renders a figure it wasn't given.
 *
 * Deliberately part of the product rather than a bolted-on chat widget: same
 * type scale, same slate palette, same card treatment as the rest of the app,
 * and every answer carries the "check this against the records" footnote.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiText } from "./ai-text";
import { AiProvenanceFootnote, AiUnavailableNotice } from "./ai-disclosure";
import { AssistantCards, BatchSummary } from "./assistant-cards";
import { cn } from "@/lib/cn";
import type { AssistantAttachment, AssistantCard, AssistantTurnResponse } from "@/lib/ai/assistant-types";

interface Turn {
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  usedFallback?: boolean;
  cards?: AssistantCard[];
  /** Filenames the user attached to their own message, for the transcript. */
  attachments?: string[];
}

const GROUP_SUGGESTIONS = [
  "Why did our emissions change compared with last year?",
  "Which Scope 3 category is largest this period?",
  "What information are we still missing?",
  "Log 1,500 litres of diesel for July.",
];

const LCA_SUGGESTIONS = [
  "What information am I missing in this assessment?",
  "Is my functional unit clear and measurable?",
  "Where are the hotspots, and why?",
  "Which flows am I missing?",
];

/**
 * Sent when a file is attached and the user pressed send without typing.
 * The server recognises this exact string and goes straight to processing the
 * document rather than asking a model what to do with it.
 */
const AUTO_ATTACHMENT_PROMPT = "Process the attached document(s).";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv";
const MAX_ATTACHMENTS = 10;

/** `/assessments/<id>` and its sub-routes put the copilot into that assessment's context. */
function lcaProjectIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/assessments\/([^/]+)/);
  const id = match?.[1];
  return id && id !== "new" ? id : null;
}

function newId(): string {
  // crypto.randomUUID is available in every browser this app supports; the
  // fallback keeps the component usable in a non-secure context rather than
  // throwing while someone is typing.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PHASE_LABEL: Record<AssistantAttachment["phase"], string> = {
  UPLOADING: "Uploading…",
  UPLOADED: "Uploaded",
  READING: "Reading…",
  READ: "Read successfully",
  FAILED: "Couldn't be read",
};

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
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setAttachments([]);
    setUnavailable(available ? null : unavailableMessage);
  }

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, open, pending, attachments]);

  const history = useMemo(() => turns.map((t) => ({ role: t.role, content: t.content })), [turns]);

  /**
   * Entries this conversation has created. The server will only let a
   * conversational reference ("change that to 1,550") resolve to one of these,
   * and re-checks ownership and provenance on top — so this list is a
   * narrowing, never an authorisation.
   */
  const conversationEntryIds = useMemo(
    () =>
      turns
        .flatMap((t) => t.cards ?? [])
        .flatMap((card) => (card.kind === "ENTRY_CREATED" ? [card.entryId] : []))
        .slice(-50),
    [turns],
  );

  const updateAttachment = useCallback((localId: string, patch: Partial<AssistantAttachment>) => {
    setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));
  }, []);

  /** Upload, then read. Two steps so the chip can say which one is happening. */
  const ingestFile = useCallback(
    async (file: File) => {
      const localId = newId();
      setAttachments((prev) => [
        ...prev,
        {
          localId,
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
          phase: "UPLOADING",
          documentId: null,
          error: null,
          reusedExisting: false,
        },
      ]);

      try {
        const form = new FormData();
        form.append("file", file);

        const uploadResponse = await fetch("/api/ai/attachments", { method: "POST", body: form });
        const uploaded = await uploadResponse.json();

        if (uploaded.error) {
          updateAttachment(localId, { phase: "FAILED", error: uploaded.error.message });
          return;
        }

        updateAttachment(localId, {
          phase: uploaded.autoExtract ? "READING" : "UPLOADED",
          documentId: uploaded.documentId,
          reusedExisting: Boolean(uploaded.reusedExisting),
        });

        if (!uploaded.autoExtract) return;

        const extractResponse = await fetch(`/api/ai/attachments/${uploaded.documentId}/extract`, { method: "POST" });
        const extracted = await extractResponse.json();

        if (extracted.error) {
          // The document is stored either way — it can still be asked about
          // and reviewed by hand, so this is a warning, not a lost file.
          updateAttachment(localId, { phase: "FAILED", error: extracted.error.message });
          return;
        }

        updateAttachment(localId, { phase: "READ" });
      } catch {
        updateAttachment(localId, { phase: "FAILED", error: "That file couldn't be uploaded." });
      }
    },
    [updateAttachment],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      // Started outside a state updater on purpose: an updater can be invoked
      // more than once for the same update, which would upload each file twice.
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) return;
      for (const file of Array.from(files).slice(0, room)) void ingestFile(file);
    },
    [attachments.length, ingestFile],
  );

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const readyAttachments = attachments.filter((a) => a.documentId !== null);
      const trimmed = text.trim();
      const message = trimmed || (readyAttachments.length > 0 ? AUTO_ATTACHMENT_PROMPT : "");

      if (!message || pending || !available) return;
      if (attachments.some((a) => a.phase === "UPLOADING" || a.phase === "READING")) return;

      const attachedNames = readyAttachments.map((a) => a.filename);
      const attachmentDocumentIds = readyAttachments.map((a) => a.documentId!) as string[];

      setQuestion("");
      setAttachments([]);
      setUnavailable(null);
      setTurns((prev) => [...prev, { role: "user", content: message, attachments: attachedNames }]);
      setPending(true);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: message,
            from,
            to,
            projectId,
            history,
            attachmentDocumentIds,
            conversationEntryIds,
            // Stable for this submitted turn: if the browser retries, the
            // server recognises the same turn and doesn't record anything twice.
            turnRequestId: newId(),
          }),
        });
        const data: AssistantTurnResponse | { error: { message?: string } } = await response.json();

        if ("error" in data) {
          setUnavailable(data.error.message ?? "AI assistance is temporarily unavailable.");
          return;
        }

        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer,
            model: data.model,
            usedFallback: data.usedFallback,
            cards: data.cards,
          },
        ]);
      } catch {
        setUnavailable("Couldn't reach the assistant. Everything else in the platform still works.");
      } finally {
        setPending(false);
      }
    },
    [attachments, from, to, history, pending, projectId, available, conversationEntryIds],
  );

  const busyAttachments = attachments.some((a) => a.phase === "UPLOADING" || a.phase === "READING");
  const canSend =
    available && !pending && !busyAttachments && (question.trim().length > 0 || attachments.some((a) => a.documentId));

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
          className={cn(
            "no-print fixed bottom-20 right-5 z-30 flex max-h-[min(40rem,calc(100vh-7rem))] w-[min(30rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border bg-white shadow-2xl",
            dragging ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-200",
          )}
          onDragOver={(e) => {
            if (!available) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            // Only clear when the pointer actually leaves the panel, not when
            // it crosses a child element's boundary.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={(e) => {
            if (!available) return;
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
          }}
        >
          <header className="shrink-0 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {projectId ? "LCA copilot" : "Carbon assistant"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {projectId
                ? "Answers from this study's recorded data and results. It never calculates an LCA figure itself."
                : "Attach an invoice or ask a question. Every figure it records is calculated by the platform, never by AI."}
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
                {!projectId && (
                  <p className="pt-1 text-xs text-slate-400">
                    Or drag an invoice, Waste Transfer Note or meter statement straight in.
                  </p>
                )}
              </div>
            )}

            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex flex-col items-end gap-1">
                  {turn.attachments && turn.attachments.length > 0 && (
                    <p className="flex flex-wrap justify-end gap-1">
                      {turn.attachments.map((name, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                        >
                          <FileText className="h-3 w-3" aria-hidden="true" />
                          {name}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="max-w-[85%] rounded-lg rounded-br-sm bg-slate-900 px-3 py-2 text-sm text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  <AiText text={turn.content} />
                  {turn.cards && turn.cards.length > 0 && (
                    <>
                      <BatchSummary cards={turn.cards} />
                      <AssistantCards cards={turn.cards} />
                    </>
                  )}
                  <AiProvenanceFootnote model={turn.model ?? null} usedFallback={turn.usedFallback} />
                </div>
              ),
            )}

            {pending && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Working…
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
            {attachments.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.localId}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                      attachment.phase === "FAILED" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50",
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{attachment.filename}</span>
                      <span className="block text-xs text-slate-500">
                        {attachment.phase === "READ" ? "✓ " : ""}
                        {PHASE_LABEL[attachment.phase]}
                        {attachment.error ? ` — ${attachment.error}` : ""}
                        {attachment.phase !== "FAILED" ? ` · ${formatSize(attachment.byteSize)}` : ""}
                        {attachment.reusedExisting ? " · already on file, re-used" : ""}
                      </span>
                    </span>
                    {(attachment.phase === "UPLOADING" || attachment.phase === "READING") && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.localId)}
                      aria-label={`Remove ${attachment.filename}`}
                      className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  // Reset so choosing the same file twice still fires a change.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!available || attachments.length >= MAX_ATTACHMENTS}
                aria-label="Attach a document"
                title="Attach an invoice, Waste Transfer Note, meter statement or photo"
                className="mb-0.5 rounded-lg border border-slate-300 p-2.5 text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <label htmlFor="ai-question" className="sr-only">
                Your message
              </label>
              <textarea
                id="ai-question"
                rows={2}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onPaste={(e) => {
                  // A screenshot of a bill is a perfectly good piece of
                  // evidence, so a pasted image is treated as an attachment.
                  const files = Array.from(e.clipboardData.files);
                  if (files.length > 0) {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(question);
                  }
                }}
                disabled={!available}
                placeholder={available ? "Ask, or attach an invoice…" : "AI assistance is unavailable"}
                className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-500"
              />
              <Button type="submit" size="sm" className="mb-0.5" disabled={!canSend} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {dragging && <p className="mt-2 text-xs font-medium text-blue-700">Drop the file to attach it.</p>}
          </form>
        </aside>
      )}
    </>
  );
}
