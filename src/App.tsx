import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Role = "user" | "assistant";
interface Message {
  id: string;
  role: Role;
  content: string;
  images?: string[]; // data URLs
}
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  style: StyleKey;
}
interface Artifact {
  msgId: string;
  lang: string;
  code: string;
}

type StyleKey = "normal" | "concis" | "expert" | "pedagogue";
type Theme = "dark" | "light";

const STYLES: Record<StyleKey, { label: string; prompt: string }> = {
  normal: { label: "Normal", prompt: "" },
  concis: { label: "Concis", prompt: "Réponds toujours de façon très concise, en allant droit au but, sans détails superflus." },
  expert: {
    label: "Expert technique",
    prompt: "Réponds comme un expert technique senior. Utilise le vocabulaire précis du domaine, ne simplifie pas inutilement, et va dans le détail quand c'est pertinent.",
  },
  pedagogue: {
    label: "Pédagogue",
    prompt: "Explique comme à quelqu'un qui découvre le sujet : utilise des analogies simples, décompose les idées complexes étape par étape.",
  },
};

const STORAGE_KEY = "sagle_conversations_v1";
const THEME_KEY = "sagle_theme";
const PREVIEWABLE = new Set(["html", "svg"]);
const uid = () => Math.random().toString(36).slice(2, 10);

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((c: Conversation) => ({ ...c, style: c.style ?? "normal" }));
  } catch {
    return [];
  }
}
function saveConversations(convs: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
}

function extractArtifacts(content: string): Artifact[] {
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  const results: Artifact[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const lang = (match[1] || "text").toLowerCase();
    const code = match[2];
    if (code.trim().length > 40) {
      results.push({ msgId: "", lang, code });
    }
  }
  return results;
}

function buildPreviewDoc(lang: string, code: string): string {
  if (lang === "svg") {
    return `<!doctype html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style></head><body>${code}</body></html>`;
  }
  if (code.includes("<html")) return code;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif}</style></head><body>${code}</body></html>`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papier indisponible */
    }
  }
  return (
    <div className="group relative">
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded-md border px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-dim)" }}
      >
        {copied ? "Copié ✓" : "Copier"}
      </button>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [artifactTab, setArtifactTab] = useState<"preview" | "code">("preview");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || "dark");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)));
  }, [conversations, search]);

  useEffect(() => saveConversations(conversations), [conversations]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [active?.messages]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  function newConversation() {
    const conv: Conversation = { id: uid(), title: "Nouvelle conversation", messages: [], createdAt: Date.now(), style: "normal" };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setError(null);
    setActiveArtifact(null);
  }
  function deleteConversation(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) { setActiveId(null); setActiveArtifact(null); }
  }
  function setStyle(style: StyleKey) {
    if (!activeId) return;
    setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, style } : c)));
  }
  function exportConversation() {
    if (!active) return;
    const lines = active.messages.map((m) => `**${m.role === "user" ? "Toi" : "Sagle"} :**\n\n${m.content}`);
    const md = `# ${active.title}\n\n${lines.join("\n\n---\n\n")}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.title.slice(0, 40) || "conversation"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files).slice(0, 4 - pendingImages.length);
    const urls = await Promise.all(arr.map(fileToDataUrl));
    setPendingImages((prev) => [...prev, ...urls].slice(0, 4));
  }

  function toApiContent(m: Message): string | Array<Record<string, unknown>> {
    if (!m.images || m.images.length === 0) return m.content;
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const img of m.images) parts.push({ type: "image_url", image_url: { url: img } });
    return parts;
  }

  async function streamCompletion(convId: string, historyMessages: Message[], assistantMsgId: string, style: StyleKey) {
    setIsStreaming(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const stylePrompt = STYLES[style].prompt;
      const apiHistory = historyMessages.map((m) => ({ role: m.role, content: toApiContent(m) }));
      const payloadMessages = stylePrompt
        ? [{ role: "user", content: `[Instruction de style, à respecter silencieusement] ${stylePrompt}` }, ...apiHistory]
        : apiHistory;

      const res = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Erreur serveur (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              fullText += delta;
              const snapshot = fullText;
              setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: snapshot } : m)) } : c))
              );
            }
          } catch { /* ligne SSE non-JSON */ }
        }
      }
      if (!fullText) throw new Error("Aucune réponse reçue du modèle. Vérifie que NVIDIA_API_KEY est bien configurée sur Netlify.");
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        setError(message);
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: "*(réponse interrompue par une erreur)*" } : m)) } : c))
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || isStreaming) return;
    let convId = activeId;
    let style: StyleKey = active?.style ?? "normal";
    if (!convId) {
      const conv: Conversation = { id: uid(), title: text.slice(0, 40) || "Image envoyée", messages: [], createdAt: Date.now(), style: "normal" };
      setConversations((prev) => [conv, ...prev]);
      convId = conv.id;
      setActiveId(conv.id);
      style = "normal";
    }
    const userMsg: Message = { id: uid(), role: "user", content: text, images: pendingImages.length ? pendingImages : undefined };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "" };
    const priorMessages = conversations.find((c) => c.id === convId)?.messages ?? [];

    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title: c.messages.length === 0 ? text.slice(0, 40) || c.title : c.title, messages: [...c.messages, userMsg, assistantMsg] } : c))
    );
    setInput("");
    setPendingImages([]);
    await streamCompletion(convId, [...priorMessages, userMsg], assistantMsg.id, style);
  }

  async function regenerate() {
    if (!active || isStreaming) return;
    const lastAssistantIdx = [...active.messages].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIdx === -1) return;
    const realIdx = active.messages.length - 1 - lastAssistantIdx;
    const historyBefore = active.messages.slice(0, realIdx);
    const assistantId = active.messages[realIdx].id;
    setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: "" } : m)) } : c)));
    await streamCompletion(active.id, historyBefore, assistantId, active.style);
  }

  function startEdit(m: Message) { setEditingId(m.id); setEditDraft(m.content); }
  async function confirmEdit() {
    if (!active || !editingId) return;
    const idx = active.messages.findIndex((m) => m.id === editingId);
    if (idx === -1) return;
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "" };
    const newMessages = [...active.messages.slice(0, idx), { ...active.messages[idx], content: editDraft }, assistantMsg];
    setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, messages: newMessages } : c)));
    setEditingId(null);
    await streamCompletion(active.id, newMessages.slice(0, -1), assistantMsg.id, active.style);
  }
  function stopStreaming() { abortRef.current?.abort(); setIsStreaming(false); }

  return (
    <div className="flex h-full" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <aside
        className={`${sidebarOpen ? "w-72" : "w-0"} shrink-0 overflow-hidden border-r transition-all duration-200`}
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="flex h-full flex-col p-3">
          <button
            onClick={newConversation}
            className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white transition"
            style={{ background: "var(--accent)" }}
          >
            + Nouvelle conversation
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher..."
            className="mb-3 rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
          />
          <div className="flex-1 space-y-1 overflow-y-auto">
            {filteredConversations.length === 0 && <p className="mt-6 text-center text-sm" style={{ color: "var(--text-faint)" }}>Aucune conversation.</p>}
            {filteredConversations.map((c) => (
              <div
                key={c.id}
                onClick={() => { setActiveId(c.id); setActiveArtifact(null); }}
                className="group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition"
                style={{ background: c.id === activeId ? "var(--surface-2)" : "transparent", color: c.id === activeId ? "var(--text)" : "var(--text-dim)" }}
              >
                <span className="truncate">{c.title || "Sans titre"}</span>
                <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }} className="ml-2 hidden shrink-0 group-hover:block" style={{ color: "var(--text-faint)" }} aria-label="Supprimer">✕</button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
            <span>Sagle — Kimi K3</span>
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="rounded-md border px-2 py-1"
              style={{ borderColor: "var(--border)" }}
              aria-label="Changer de thème"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen((v) => !v)} className="rounded-md p-1.5" style={{ color: "var(--text-dim)" }} aria-label="Sidebar">☰</button>
            <h1 className="font-display text-lg font-semibold tracking-tight">
              Sagle
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {active && (
              <select
                value={active.style}
                onChange={(e) => setStyle(e.target.value as StyleKey)}
                className="rounded-md border px-2 py-1 text-xs outline-none"
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-dim)" }}
              >
                {Object.entries(STYLES).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
              </select>
            )}
            {active && active.messages.length > 0 && (
              <button onClick={exportConversation} className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
                Exporter .md
              </button>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto max-w-3xl space-y-6">
              {!active || active.messages.length === 0 ? (
                <div className="flex h-[60vh] flex-col items-center justify-center text-center">
                  <h2 className="font-display text-3xl font-semibold">Bonjour. Je suis Sagle.</h2>
                  <p className="mt-2 max-w-md" style={{ color: "var(--text-dim)" }}>
                    Pose-moi une question, envoie-moi une image, ou demande-moi d'écrire du code — je peux t'en montrer un aperçu live.
                  </p>
                </div>
              ) : (
                active.messages.map((m, idx) => {
                  const isLastAssistant = m.role === "assistant" && idx === active.messages.length - 1 && !isStreaming && m.content;
                  const artifacts = m.role === "assistant" ? extractArtifacts(m.content).map((a) => ({ ...a, msgId: m.id })) : [];
                  return (
                    <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                      <div
                        className="max-w-[85%] rounded-2xl px-4 py-3"
                        style={m.role === "user" ? { background: "var(--accent)", color: "#fff" } : { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
                      >
                        {m.images && m.images.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {m.images.map((img, i) => <img key={i} src={img} className="h-24 w-24 rounded-lg object-cover" />)}
                          </div>
                        )}
                        {m.role === "assistant" ? (
                          m.content ? (
                            <div className="prose-sagle">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: ({ children }) => <>{children}</>, code: CodeBlock }}>
                                {m.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <div className="flex gap-1 py-1">
                              <span className="thinking-dot h-2 w-2 rounded-full" style={{ background: "var(--text-faint)", animationDelay: "0ms" }} />
                              <span className="thinking-dot h-2 w-2 rounded-full" style={{ background: "var(--text-faint)", animationDelay: "150ms" }} />
                              <span className="thinking-dot h-2 w-2 rounded-full" style={{ background: "var(--text-faint)", animationDelay: "300ms" }} />
                            </div>
                          )
                        ) : editingId === m.id ? (
                          <div className="min-w-[240px]">
                            <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3} className="w-full resize-none rounded-md bg-white/20 p-2 text-sm text-white outline-none" />
                            <div className="mt-2 flex justify-end gap-2 text-xs">
                              <button onClick={() => setEditingId(null)} className="rounded px-2 py-1 hover:bg-white/10">Annuler</button>
                              <button onClick={confirmEdit} className="rounded bg-white/20 px-2 py-1 hover:bg-white/30">Renvoyer</button>
                            </div>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        )}
                      </div>
                      {artifacts.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {artifacts.map((a, i) => (
                            <button
                              key={i}
                              onClick={() => { setActiveArtifact(a); setArtifactTab(PREVIEWABLE.has(a.lang) ? "preview" : "code"); }}
                              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                              style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--accent)" }}
                            >
                              ◆ Artifact — {a.lang}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 flex gap-3 px-1 text-xs" style={{ color: "var(--text-faint)" }}>
                        {m.role === "user" && editingId !== m.id && <button onClick={() => startEdit(m)}>Éditer</button>}
                        {isLastAssistant && <button onClick={regenerate}>Régénérer</button>}
                      </div>
                    </div>
                  );
                })
              )}
              {error && (
                <div className="mx-auto max-w-3xl rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>
                  <strong>Erreur :</strong> {error}
                </div>
              )}
            </div>
          </div>

          {activeArtifact && (
            <div className="flex w-[42%] min-w-[360px] flex-col border-l" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
                <div className="flex gap-1">
                  {PREVIEWABLE.has(activeArtifact.lang) && (
                    <button onClick={() => setArtifactTab("preview")} className="rounded-md px-2 py-1 text-xs" style={{ background: artifactTab === "preview" ? "var(--surface-2)" : "transparent", color: "var(--text)" }}>Aperçu</button>
                  )}
                  <button onClick={() => setArtifactTab("code")} className="rounded-md px-2 py-1 text-xs" style={{ background: artifactTab === "code" ? "var(--surface-2)" : "transparent", color: "var(--text)" }}>Code</button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const blob = new Blob([activeArtifact.code], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `artifact.${activeArtifact.lang === "svg" ? "svg" : activeArtifact.lang === "html" ? "html" : "txt"}`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="rounded-md border px-2 py-1 text-xs"
                    style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
                  >
                    Télécharger
                  </button>
                  <button onClick={() => setActiveArtifact(null)} style={{ color: "var(--text-faint)" }} aria-label="Fermer">✕</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                {artifactTab === "preview" && PREVIEWABLE.has(activeArtifact.lang) ? (
                  <iframe title="Aperçu de l'artifact" srcDoc={buildPreviewDoc(activeArtifact.lang, activeArtifact.code)} sandbox="allow-scripts" className="h-full w-full bg-white" />
                ) : (
                  <pre className="h-full overflow-auto p-4 text-xs" style={{ color: "var(--text)" }}><code>{activeArtifact.code}</code></pre>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto max-w-3xl">
            {pendingImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img} className="h-16 w-16 rounded-lg object-cover" />
                    <button onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-xs text-white">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border p-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={pendingImages.length >= 4}
                className="shrink-0 rounded-lg p-2 text-sm disabled:opacity-30"
                style={{ color: "var(--text-dim)" }}
                aria-label="Ajouter une image"
                title="Ajouter une image"
              >
                📎
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Écris un message à Sagle..."
                rows={1}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
                style={{ color: "var(--text)" }}
              />
              {isStreaming ? (
                <button onClick={stopStreaming} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: "color-mix(in srgb, var(--danger) 20%, transparent)", color: "var(--danger)" }}>Arrêter</button>
              ) : (
                <button onClick={sendMessage} disabled={!input.trim() && pendingImages.length === 0} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>Envoyer</button>
              )}
            </div>
            <p className="mt-2 text-center text-xs" style={{ color: "var(--text-faint)" }}>Sagle peut faire des erreurs. Vérifie les informations importantes.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
