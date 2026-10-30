// Local fixture servers for the integration tests (127.0.0.1 only).

import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

export const ARTICLE_TEXT =
  'Aether is a privacy-first browser. It fetches pages on the server, strips scripts and trackers, and shows a clean reader view. ';

export function articleHtml(origin: string): string {
  const paragraphs = Array.from({ length: 12 }, (_, i) => `<p>${ARTICLE_TEXT}Paragraph number ${i + 1} explains more details about readable content.</p>`).join('\n');
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>Fixture Article Title</title>
  <meta name="description" content="A fixture article for Aether tests.">
  <meta property="og:site_name" content="Fixture Times">
  <meta property="og:image" content="/images/cover.jpg">
  <meta name="author" content="Ada Lovelace">
  <meta property="article:published_time" content="2026-10-01T12:00:00Z">
  <link rel="icon" href="/static/icon.png">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
  <link rel="preconnect" href="https://cdn.segment.com">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    (function(h,o,t,j,a,r){ r=o.createElement('script'); r.src='https://static.hotjar.com/c/hotjar-123.js'; })(window,document);
  </script>
  <script src="/app.js"></script>
  <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <article>
    <h1>Fixture Article Title</h1>
    <p class="byline">By Ada Lovelace</p>
    ${paragraphs}
    <p>Read <a href="/related/story">the related story</a> or <a href="javascript:alert(1)" onclick="steal()">click here</a>.</p>
    <figure><img src="/images/photo.jpg" srcset="/images/photo-2x.jpg 2x, /images/photo-3x.jpg 3x" alt="A photo" onerror="steal()"></figure>
    <img src="https://www.facebook.com/tr?id=1&ev=PageView" width="1" height="1" alt="">
    <img src="${origin}/pixel.gif" width="1" height="1" alt="">
    <img src="https://pixel.quantserve.com/pixel/p-123.gif" alt="">
    <iframe src="https://www.youtube.com/embed/abc"></iframe>
    <form action="/subscribe"><input name="email"><button>Go</button></form>
    <style>.x{color:red}</style>
  </article>
  <noscript><img src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1"></noscript>
  <footer>Copyright Fixture Times</footer>
</body>
</html>`;
}

export interface Fixture {
  origin: string;
  port: number;
  /** Request headers seen by /echo-headers and by the article route. */
  seenHeaders: http.IncomingHttpHeaders[];
  close(): Promise<void>;
}

export const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082',
  'hex',
);

export async function startFixture(): Promise<Fixture> {
  const seenHeaders: http.IncomingHttpHeaders[] = [];
  let origin = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin);
    const send = (status: number, headers: http.OutgoingHttpHeaders, body?: string | Buffer) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    switch (url.pathname) {
      case '/article':
        seenHeaders.push(req.headers);
        res.setHeader('set-cookie', ['session=abc123; HttpOnly; Path=/', 'tracking_id=xyz; Max-Age=31536000']);
        return send(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'SAMEORIGIN' }, articleHtml(origin));
      case '/csp-article':
        return send(
          200,
          { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; frame-ancestors *" },
          articleHtml(origin),
        );
      case '/gzip':
        return send(
          200,
          { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' },
          gzipSync(Buffer.from(articleHtml(origin))),
        );
      case '/r1':
        res.setHeader('set-cookie', 'hop1=1; Path=/');
        return send(302, { location: '/r2' });
      case '/r2':
        return send(301, { location: `${origin}/article` });
      case '/loop': {
        const n = Number(url.searchParams.get('n') ?? '0');
        return send(302, { location: `/loop?n=${n + 1}` });
      }
      case '/to-ftp':
        return send(302, { location: 'ftp://example.com/file' });
      case '/big': {
        // 4 MB of HTML, chunked (no content-length), to exercise the streaming cap.
        res.writeHead(200, { 'content-type': 'text/html' });
        const chunk = '<p>' + 'x'.repeat(64 * 1024 - 7) + '</p>';
        let sent = 0;
        const write = () => {
          while (sent < 64) {
            sent++;
            if (!res.write(chunk)) return void res.once('drain', write);
          }
          res.end();
        };
        res.on('error', () => {});
        return write();
      }
      case '/big-declared':
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(4 * 1024 * 1024) });
        res.on('error', () => {});
        return res.write('<p>partial</p>');
      case '/doc.pdf':
        return send(200, { 'content-type': 'application/pdf' }, '%PDF-1.4 fake');
      case '/notes.txt':
        return send(200, { 'content-type': 'text/plain; charset=utf-8' }, 'Plain notes.\n\nSecond paragraph of notes.');
      case '/slow':
        return void setTimeout(() => send(200, { 'content-type': 'text/html' }, '<p>late</p>'), 12_000);
      case '/echo-headers':
        seenHeaders.push(req.headers);
        return send(200, { 'content-type': 'text/html' }, '<html><body><p>echo</p></body></html>');
      case '/img.png':
        return send(200, { 'content-type': 'image/png', 'set-cookie': 'imgcookie=1' }, PNG_1PX);
      case '/img.svg':
        return send(200, { 'content-type': 'image/svg+xml' }, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      case '/big.png':
        return send(200, { 'content-type': 'image/png' }, Buffer.alloc(6 * 1024 * 1024));
      case '/missing.png':
        return send(404, { 'content-type': 'text/html' }, 'nope');
      default:
        return send(404, { 'content-type': 'text/html' }, '<h1>Not found</h1>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    port,
    seenHeaders,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface ProxyFixture {
  port: number;
  requests: Array<{ url: string; auth?: string }>;
  close(): Promise<void>;
}

/** Minimal HTTP forward proxy (absolute-form requests only). */
export async function startHttpProxy(requiredAuth?: string): Promise<ProxyFixture> {
  const requests: ProxyFixture['requests'] = [];
  const server = http.createServer((req, res) => {
    const auth = req.headers['proxy-authorization'];
    requests.push({ url: req.url ?? '', ...(auth ? { auth } : {}) });
    if (requiredAuth && auth !== requiredAuth) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="fixture"' });
      return res.end();
    }
    const target = new URL(req.url ?? '');
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const up = http.request(
      { host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface SocksFixture {
  port: number;
  connects: Array<{ host: string; port: number; user?: string }>;
  close(): Promise<void>;
}

/** Minimal SOCKS5 server (RFC 1928/1929) supporting CONNECT and optional user/pass auth. */
export async function startSocks5(credentials?: { user: string; pass: string }): Promise<SocksFixture> {
  const connects: SocksFixture['connects'] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => {});
    let buf = Buffer.alloc(0);
    let stage: 'greeting' | 'auth' | 'request' | 'piped' = 'greeting';
    let user: string | undefined;
    const onData = (data: Buffer) => {
      buf = Buffer.concat([buf, data]);
      if (stage === 'greeting') {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        const methods = [...buf.subarray(2, 2 + buf[1]!)];
        buf = buf.subarray(2 + buf[1]!);
        if (credentials) {
          if (!methods.includes(2)) return void client.end(Buffer.from([5, 0xff]));
          client.write(Buffer.from([5, 2]));
          stage = 'auth';
        } else {
          client.write(Buffer.from([5, 0]));
          stage = 'request';
        }
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const ulen = buf[1]!;
        if (buf.length < 3 + ulen) return;
        const plen = buf[2 + ulen]!;
        if (buf.length < 3 + ulen + plen) return;
        user = buf.subarray(2, 2 + ulen).toString();
        const pass = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
        buf = buf.subarray(3 + ulen + plen);
        if (user !== credentials!.user || pass !== credentials!.pass) return void client.end(Buffer.from([1, 1]));
        client.write(Buffer.from([1, 0]));
        stage = 'request';
      }
      if (stage === 'request') {
        if (buf.length < 5) return;
        const atyp = buf[3]!;
        let host: string;
        let off: number;
        if (atyp === 1) {
          if (buf.length < 10) return;
          host = [...buf.subarray(4, 8)].join('.');
          off = 8;
        } else if (atyp === 3) {
          const len = buf[4]!;
          if (buf.length < 5 + len + 2) return;
          host = buf.subarray(5, 5 + len).toString();
          off = 5 + len;
        } else {
          return void client.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]));
        }
        const port = buf.readUInt16BE(off);
        const rest = buf.subarray(off + 2);
        connects.push({ host, port, ...(user ? { user } : {}) });
        stage = 'piped';
        client.off('data', onData);
        const upstream = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length) upstream.write(rest);
          client.pipe(upstream);
          upstream.pipe(client);
        });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        upstream.on('error', () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
      }
    };
    client.on('data', onData);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connects,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A TCP port with nothing listening on it. */
export async function deadPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
