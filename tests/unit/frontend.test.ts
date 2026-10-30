import { describe, expect, it } from 'vitest';
import { cleanTitle, displayUrl, parseInternal, resolveInput } from '../../src/lib/util.ts';
import { handleStreamData, readSse } from '../../src/lib/ai/providers.ts';

describe('resolveInput', () => {
  it('keeps full URLs', () => expect(resolveInput('https://example.com/a?b=1', 'aether')).toBe('https://example.com/a?b=1'));
  it('adds https to bare hosts', () => {
    expect(resolveInput('example.com', 'aether')).toBe('https://example.com/');
    expect(resolveInput('sub.example.co.uk/path', 'aether')).toBe('https://sub.example.co.uk/path');
    expect(resolveInput('localhost:3000', 'aether')).toBe('https://localhost:3000/');
  });
  it('treats phrases as searches', () => {
    expect(resolveInput('how does glass work', 'aether')).toBe('aether://search?q=how%20does%20glass%20work');
    expect(resolveInput('glass', 'duckduckgo')).toBe('https://duckduckgo.com/?q=glass');
  });
  it('passes through internal pages', () => expect(resolveInput('aether://privacy', 'aether')).toBe('aether://privacy'));
  it('empty → new tab', () => expect(resolveInput('  ', 'aether')).toBe('aether://newtab'));
});

describe('parseInternal', () => {
  it('parses page, params and hash', () => {
    const r = parseInternal('aether://library?x=1#notes/abc');
    expect(r.page).toBe('library');
    expect(r.params.get('x')).toBe('1');
    expect(r.hash).toBe('notes/abc');
  });
  it('unknown pages fall back to newtab', () => expect(parseInternal('aether://nope').page).toBe('newtab'));
});

describe('display helpers', () => {
  it('keeps ports and drops www', () => expect(displayUrl('http://www.example.com:8080/a')).toBe('example.com:8080/a'));
  it('strips duplicated site-name suffixes only', () => {
    expect(cleanTitle('The Quiet Physics of Glass | Fixture Times', 'Fixture Times')).toBe('The Quiet Physics of Glass');
    expect(cleanTitle('Rust 2.0 released - The Verge', undefined, 'www.theverge.com')).toBe('Rust 2.0 released');
    expect(cleanTitle('Pros - and cons of glass', 'Example')).toBe('Pros - and cons of glass');
  });
});

describe('AI stream parsing', () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((x) => c.enqueue(new TextEncoder().encode(x)));
        c.close();
      },
    });

  it('parses OpenAI-style SSE split across chunks', async () => {
    let out = '';
    await readSse(
      stream(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n', '\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n', 'data: [DONE]\n\n']),
      (d) => handleStreamData('openai', d, (t) => (out += t)),
    );
    expect(out).toBe('Hello');
  });

  it('parses Anthropic SSE and ignores non-text events', async () => {
    let out = '';
    const ev = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
    await readSse(
      stream([
        ev({ type: 'message_start' }),
        ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } }),
        ev({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } }),
        ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } }),
        ev({ type: 'message_stop' }),
      ]),
      (d) => handleStreamData('anthropic', d, (t) => (out += t)),
    );
    expect(out).toBe('Hi there');
  });

  it('surfaces provider errors', () => {
    expect(() => handleStreamData('anthropic', JSON.stringify({ type: 'error', error: { message: 'overloaded' } }), () => {})).toThrow('overloaded');
  });
});
