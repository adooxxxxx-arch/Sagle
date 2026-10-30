// Minimal, dependency-free HTML → Markdown for exporting reader pages and notes.

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ');
  if (!(node instanceof HTMLElement)) return '';
  const kids = () => Array.from(node.childNodes).map(inline).join('');
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      return `**${kids().trim()}**`;
    case 'EM':
    case 'I':
      return `*${kids().trim()}*`;
    case 'CODE':
      return '`' + (node.textContent || '') + '`';
    case 'A': {
      const href = node.getAttribute('href');
      const text = kids().trim();
      return href && /^https?:/.test(href) ? `[${text || href}](${href})` : text;
    }
    case 'IMG': {
      const src = node.getAttribute('src');
      return src && /^https?:/.test(src) ? `![${node.getAttribute('alt') || ''}](${src})` : '';
    }
    case 'BR':
      return '  \n';
    default:
      return kids();
  }
}

function block(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent || '').trim();
    return t ? t + '\n\n' : '';
  }
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.tagName;
  const children = () => Array.from(node.childNodes).map((c) => block(c, depth)).join('');
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(node).trim()}\n\n`;
  switch (tag) {
    case 'P':
      return inline(node).trim() + '\n\n';
    case 'UL':
    case 'OL': {
      const items = Array.from(node.children).filter((c) => c.tagName === 'LI');
      return (
        items
          .map((li, i) => {
            const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
            const own = Array.from(li.childNodes)
              .filter((c) => !nested.includes(c as Element))
              .map(inline)
              .join('')
              .trim();
            const bullet = tag === 'OL' ? `${i + 1}.` : '-';
            return `${'  '.repeat(depth)}${bullet} ${own}\n${nested.map((n) => block(n, depth + 1)).join('')}`;
          })
          .join('') + (depth === 0 ? '\n' : '')
      );
    }
    case 'PRE':
      return '```\n' + (node.textContent || '').replace(/\n$/, '') + '\n```\n\n';
    case 'BLOCKQUOTE':
      return (
        children()
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n') + '\n\n'
      );
    case 'HR':
      return '---\n\n';
    case 'IMG':
    case 'A':
    case 'STRONG':
    case 'EM':
    case 'CODE':
    case 'SPAN':
      return inline(node).trim() + '\n\n';
    case 'TABLE': {
      const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, '\\|')),
      );
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const fmt = (r: string[]) => '| ' + Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ') + ' |';
      return [fmt(rows[0]), '| ' + Array(width).fill('---').join(' | ') + ' |', ...rows.slice(1).map(fmt)].join('\n') + '\n\n';
    }
    default:
      return children();
  }
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return block(doc.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
