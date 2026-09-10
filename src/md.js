'use strict';

/**
 * Minimal, dependency-free Markdown -> HTML renderer. Supports the subset used by
 * SPEC.md / ABOUT.md: ATX headings, paragraphs, unordered / ordered lists,
 * fenced code blocks, GFM pipe tables, thematic breaks, inline code, bold, and
 * links. Not a general Markdown implementation.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const BLOCK_START = /^(#{1,6}\s|```|\||\s*[-*]\s|\s*\d+\.\s|---+\s*$|>\s?)/;

function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let out = '';
  let i = 0;

  const parseRow = (r) =>
    r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out += `<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out += `<h${level}>${inline(heading[2].trim())}</h${level}>`;
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      out += '<hr>';
      i++;
      continue;
    }

    if (/^\|(.+)\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|(.+)\|\s*$/.test(lines[i])) rows.push(parseRow(lines[i++]));
      out +=
        '<table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows
          .map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
          .join('') +
        '</tbody></table>';
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out += '<ul>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ul>';
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out += '<ol>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ol>';
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out += `<blockquote>${inline(buf.join(' '))}</blockquote>`;
      continue;
    }

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out += `<p>${inline(buf.join(' '))}</p>`;
  }

  return out;
}

module.exports = { renderMarkdown, escapeHtml };
