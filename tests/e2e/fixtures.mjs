// Local fixture site for end-to-end tests: real HTTP pages with trackers, cookies and framing
// headers, plus a fake OpenAI-compatible streaming endpoint that records what it was sent.
import http from 'node:http';

export const ARTICLE_TITLE = 'The Quiet Physics of Glass';
const article = `<!doctype html><html lang="en"><head><title>${ARTICLE_TITLE} | Fixture Times</title>
<meta property="og:site_name" content="Fixture Times"><meta name="description" content="Why glass is a solid that remembers being a liquid.">
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
<script>window.evil = true; document.title = 'hacked';</script>
<link rel="stylesheet" href="https://cdn.fixture-cdn.net/site.css">
</head><body><nav>Home · World · Science</nav>
<article><h1>${ARTICLE_TITLE}</h1><p class="byline">By Ada Lovelace</p>
<p>Glass is an amorphous solid. Unlike crystals, its atoms have no long-range order, which is why it fractures along smooth curves.</p>
<p>Window glass is mostly silica, soda and lime. The soda lowers the melting point of silica from about 1700 °C to a far more workable temperature.</p>
<p>A popular myth says old cathedral windows are thicker at the bottom because glass flows. Measurements show room-temperature glass would need longer than the age of the universe to sag visibly.</p>
<p>Modern float glass is made by pouring molten glass onto a bed of molten tin, producing perfectly flat sheets. <a href="/embeddable">Read the companion piece</a>.</p>
<img src="https://pixel.quantserve.com/pixel.gif" width="1" height="1">
<p onclick="alert(1)">Tempered glass is heated and rapidly cooled so that its surface is in compression, making it about four times stronger.</p>
</article><footer>© Fixture Times</footer></body></html>`;

const embeddable = `<!doctype html><html><head><title>Companion Piece</title></head><body style="font-family:sans-serif;padding:40px">
<h1>Companion Piece</h1><p>This page allows embedding, so Aether shows it live.</p></body></html>`;

export function startFixtures(port = 8765) {
  const aiRequests = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/article') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'set-cookie': ['session=abc; Path=/', 'tracking_id=xyz; Path=/'],
      });
      return res.end(article);
    }
    if (req.url === '/embeddable') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(embeddable);
    }
    if (req.url === '/v1/chat/completions' && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'POST',
      });
      return res.end();
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body);
        aiRequests.push({ auth: req.headers.authorization, body: json });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
        const parts = ['**Summary:** ', 'Glass is an amorphous solid ', '[1]', ', and the flowing-window story is a myth [1].\n\n', '| Fact | Value |\n|---|---|\n| Strength gain | ~4× [1] |\n'];
        let i = 0;
        const tick = () => {
          if (i < parts.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
            setTimeout(tick, 30);
          } else {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        };
        tick();
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, aiRequests, base: `http://127.0.0.1:${port}` })));
}
