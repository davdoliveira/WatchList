// Extração de dados do HTML do Letterboxd.
// Sem dependências: corre em Cloudflare Workers e em Node.
// Tolera as duas versões de markup conhecidas (data-film-* e data-item-*).

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = (g[1] === 'x' || g[1] === 'X') ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    const v = NAMED[g.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function attrsOf(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3]);
  return out;
}

// Qualquer elemento (div, li, figure, componentes personalizados…), com atributos entre aspas.
const tagRegex = () => /<[a-zA-Z][a-zA-Z0-9-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** Tags de poster (as que trazem o slug do filme). Útil também para depuração. */
export function filmTags(html) {
  const out = [];
  const re = tagRegex();
  let m;
  while ((m = re.exec(html))) {
    if (/data-(?:film|item)-slug\s*=/i.test(m[0])) out.push(m[0]);
  }
  return out;
}

function slugToName(slug) {
  return slug.replace(/-(?:18|19|20)\d{2}$/, '').split('-').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Devolve [{ slug, name, year, id }] pela ordem em que aparecem na página. */
export function parseFilms(html) {
  const films = [];
  const seen = new Set();
  for (const t of filmTags(html)) {
    const a = attrsOf(t);
    const slug = a['data-film-slug'] || a['data-item-slug'];
    if (!slug || seen.has(slug)) continue;
    const link = a['data-item-link'] || a['data-target-link'] || a['data-film-link'] || '';
    // Ignora listas, pessoas, etc. (aceita /film/x/, /user/film/x/ ou URL absoluto).
    if (link && !/\/film\//.test(link)) continue;
    let name = a['data-film-name'] || a['data-item-name'] || a['data-item-full-display-name'] || '';
    let year = parseInt(a['data-film-release-year'] || a['data-item-release-year'] || '', 10) || 0;
    const ym = name.match(/\s*\((\d{4})\)\s*$/);
    if (ym) { if (!year) year = +ym[1]; name = name.slice(0, ym.index); }
    seen.add(slug);
    films.push({
      slug,
      name: name.trim() || slugToName(slug),
      year,
      id: parseInt(a['data-film-id'] || '', 10) || 0
    });
  }

  if (!films.length) {
    // Plano B: qualquer href ou atributo data-*link que aponte para /film/slug/
    // (também /user/film/slug/ ou URL absoluto). O nome sai do slug; menos fiável.
    const re = /(?:href|data-[\w-]*link)\s*=\s*"(?:https?:\/\/(?:www\.)?letterboxd\.com)?\/(?:[A-Za-z0-9_]+\/)?film\/([a-z0-9][a-z0-9-]*)\/[^"]*"/gi;
    let m;
    while ((m = re.exec(html))) {
      const slug = m[1].toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      const ys = slug.match(/-((?:18|19|20)\d{2})$/);
      films.push({ slug, name: slugToName(slug), year: ys ? +ys[1] : 0, id: 0, approx: true });
    }
  }
  return films;
}

/** Listas de um utilizador, a partir de /{user}/lists/. */
export function parseLists(html, user) {
  const u = String(user).replace(/[^A-Za-z0-9_]/g, '');
  const found = new Map();
  const titled = new RegExp(`<h[23][^>]*>\\s*<a[^>]+href="/${u}/list/([a-z0-9-]+)/"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  let m;
  while ((m = titled.exec(html))) {
    const slug = m[1].toLowerCase();
    const title = decode(m[2].replace(/<[^>]*>/g, '')).trim();
    if (title && !found.has(slug)) found.set(slug, title);
  }
  const any = new RegExp(`href="/${u}/list/([a-z0-9-]+)/"`, 'gi');
  while ((m = any.exec(html))) {
    const slug = m[1].toLowerCase();
    if (!found.has(slug)) found.set(slug, slugToName(slug));
  }
  return [...found].map(([slug, title]) => ({ slug, title, path: `/${u}/list/${slug}/` }));
}

/** Existe uma página seguinte? (o "Older" ativo é um <a class="next">). */
export function hasNext(html) {
  return /<a\b[^>]*class="[^"]*\bnext\b[^"]*"[^>]*>/i.test(html) || /<link\b[^>]*rel="next"/i.test(html);
}
