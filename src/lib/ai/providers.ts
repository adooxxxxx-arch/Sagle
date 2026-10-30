import { AI_STREAM_FORMAT_HEADER, type AiChatMessage, type AiStreamFormat, type ApiError } from '../../../shared/api.ts';
import type { AiProviderId, AiSettings } from '../types.ts';

export interface ProviderInfo {
  id: AiProviderId;
  label: string;
  kind: 'server' | 'byok' | 'local';
  /** Vault key holding the user's API key, for BYOK providers. */
  keyName?: string;
  description: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'aether-nvidia',
    label: 'Aether Cloud · NVIDIA',
    kind: 'server',
    description: 'Runs through this deployment’s server key (NVIDIA NIM). Content is sent to NVIDIA via Aether’s server.',
  },
  {
    id: 'aether-anthropic',
    label: 'Aether Cloud · Claude',
    kind: 'server',
    description: 'Runs through this deployment’s server Anthropic key. Content is sent to Anthropic via Aether’s server.',
  },
  {
    id: 'anthropic',
    label: 'Claude (your key)',
    kind: 'byok',
    keyName: 'key:anthropic',
    description: 'Your browser calls api.anthropic.com directly with your key. Aether’s server never sees it.',
  },
  {
    id: 'openai',
    label: 'OpenAI (your key)',
    kind: 'byok',
    keyName: 'key:openai',
    description: 'Your browser calls api.openai.com directly with your key.',
  },
  {
    id: 'compatible',
    label: 'OpenAI-compatible (your key)',
    kind: 'byok',
    keyName: 'key:compatible',
    description: 'Any OpenAI-compatible endpoint that allows browser CORS (e.g. OpenRouter, Groq, Together).',
  },
  {
    id: 'ollama',
    label: 'Local model · Ollama',
    kind: 'local',
    description: 'Runs on your own machine. Nothing leaves your device. Requires OLLAMA_ORIGINS to allow this site.',
  },
];

export function providerInfo(id: AiProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export class AiError extends Error {}

export interface StreamOptions {
  provider: AiProviderId;
  settings: AiSettings;
  apiKey?: string;
  system: string;
  messages: AiChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as Partial<ApiError> & { error?: { message?: string } | string; message?: string };
    const msg = typeof j.error === 'string' ? j.error : j.error?.message || j.message;
    if (msg) return `${msg} (HTTP ${res.status})`;
  } catch {
    /* not JSON */
  }
  return `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
}

/** Parse a Server-Sent Events body and hand each JSON `data:` payload to `onEvent`. */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void | 'stop') {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = rawEvent
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data && onData(data) === 'stop') {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
  const tail = buffer
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('\n');
  if (tail) onData(tail);
}

export function handleStreamData(format: AiStreamFormat, data: string, onDelta: (t: string) => void): void | 'stop' {
  if (format === 'openai') {
    if (data === '[DONE]') return 'stop';
    let j: { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } };
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.error) throw new AiError(j.error.message || 'Provider error');
    const t = j.choices?.[0]?.delta?.content;
    if (t) onDelta(t);
    return;
  }
  let j: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
  try {
    j = JSON.parse(data);
  } catch {
    return;
  }
  if (j.type === 'error') throw new AiError(j.error?.message || 'Provider error');
  if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) onDelta(j.delta.text);
  if (j.type === 'message_stop') return 'stop';
}

function trimBase(url: string) {
  return url.replace(/\/+$/, '');
}

export async function streamChat(o: StreamOptions): Promise<void> {
  let res: Response;
  let format: AiStreamFormat = 'openai';
  const model = o.settings.models[o.provider];
  try {
    switch (o.provider) {
      case 'aether-nvidia':
      case 'aether-anthropic': {
        res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: o.provider === 'aether-nvidia' ? 'nvidia' : 'anthropic',
            system: o.system,
            messages: o.messages,
            maxTokens: 4096,
          }),
          signal: o.signal,
        });
        format = (res.headers.get(AI_STREAM_FORMAT_HEADER) as AiStreamFormat) || 'openai';
        break;
      }
      case 'anthropic': {
        if (!o.apiKey) throw new AiError('Add your Anthropic API key in Settings → AI.');
        format = 'anthropic';
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': o.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: 4096, system: o.system, messages: o.messages, stream: true }),
          signal: o.signal,
        });
        break;
      }
      case 'openai':
      case 'compatible':
      case 'ollama': {
        const base =
          o.provider === 'openai'
            ? 'https://api.openai.com/v1'
            : o.provider === 'compatible'
              ? trimBase(o.settings.compatibleBaseUrl)
              : trimBase(o.settings.ollamaBaseUrl) + '/v1';
        if (o.provider !== 'ollama' && !o.apiKey) throw new AiError('Add your API key in Settings → AI.');
        if (!model) throw new AiError('Choose a model name in Settings → AI.');
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: o.system }, ...o.messages] }),
          signal: o.signal,
        });
        break;
      }
    }
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    const hint =
      o.provider === 'ollama'
        ? ' Is Ollama running, and is OLLAMA_ORIGINS set to allow this site?'
        : o.provider === 'compatible'
          ? ' The endpoint may not allow browser (CORS) requests.'
          : '';
    throw new AiError(`Could not reach the AI provider.${hint}`);
  }
  if (!res.ok || !res.body) throw new AiError(await readError(res));
  await readSse(res.body, (data) => handleStreamData(format, data, o.onDelta));
}
