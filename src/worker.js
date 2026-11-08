// Proxy sem estado para o Letterboxd (Cloudflare Worker).
//  - /api/login  : faz login e devolve o cookie de sessão (nada é guardado aqui)
//  - /api/films  : lê UMA página de uma lista/watchlist/likes/popular e devolve JSON
//  - /api/lists  : lista as listas de um utilizador
//  - /api/debug  : diagnóstico (o que o scraper "vê" numa página)
// Tudo o resto é servido como ficheiros estáticos (pasta public/).
//
// Segurança: se definires o secret ACCESS_KEY, todos os pedidos /api/* têm de
// trazer o cabeçalho X-Access-Key igual. Assim ninguém usa o teu proxy.

import { parseFilms, parseLists, hasNext, filmTags } from './parse.js';

const LB = 'https://letterboxd.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env && env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (!authorized(request, env || {})) {
      return json({ error: 'Chave de acesso inválida ou em falta.', needAccessKey: true }, 401);
    }
    try {
      switch (url.pathname) {
        case '/api/ping': return json({ ok: true });
        case '/api/login':
          if (request.method !== 'POST') return json({ error: 'Usa POST.' }, 405);
          return await handleLogin(request);
        case '/api/films': return await handleFilms(url, request);
        case '/api/lists': return await handleLists(url, request);
        case '/api/debug': return await handleDebug(url, request);
        default: return json({ error: 'Rota desconhecida.' }, 404);
      }
    } catch (e) {
      return json({ error: 'Erro interno: ' + ((e && e.message) || e) }, 500);
    }
  }
};

/* ---------- utilitários ---------- */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function authorized(request, env) {
  if (!env.ACCESS_KEY) return true;
  return safeEqual(request.headers.get('X-Access-Key') || '', String(env.ACCESS_KEY));
}

/** Cookie enviado pelo cliente. '' = sem sessão; null = inválido. */
function cookieFrom(request) {
  const c = request.headers.get('X-LB-Cookie') || '';
  if (!c) return '';
  if (c.length > 4000 || /[\r\n]/.test(c)) return null;
  return c;
}

/** Só caminhos simples do letterboxd.com; o host é fixo (sem SSRF). */
function safePath(p) {
  if (typeof p !== 'string' || p.length > 300) return null;
  if (!/^\/[A-Za-z0-9_\-./%]*$/.test(p)) return null;
  if (p.includes('..') || p.includes('//')) return null;
  if (/logout|sign-out|\.do\b|settings|delete/i.test(p)) return null;
  return p;
}

function pathWithPage(base, page) {
  const p = base.endsWith('/') ? base : base + '/';
  const n = parseInt(page || '1', 10);
  if (!Number.isInteger(n) || n < 1 || n > 200) return null;
  return n > 1 ? `${p}page/${n}/` : p;
}

async function lbFetch(path, cookie) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9'
  };
  if (cookie) headers.Cookie = cookie;
  return fetch(LB + path, { headers, redirect: 'follow' });
}

/** Converte respostas problemáticas num erro legível; null = tudo bem. */
function classify(r, hasCookie) {
  let pathname = '';
  try { pathname = new URL(r.url).pathname; } catch { /* r.url pode vir vazio em testes */ }
  if (/^\/(sign-in|user\/login)/.test(pathname)) {
    return { status: 401, body: { error: 'Esta página exige sessão iniciada no Letterboxd.', needLogin: true } };
  }
  if (r.status === 404) {
    return {
      status: 404,
      body: {
        error: 'Página não encontrada no Letterboxd (404). Confirma o username/URL.' +
          (hasCookie ? '' : ' Se a lista for privada, inicia sessão.'),
        notFound: true
      }
    };
  }
  if (r.status === 403 || r.status === 429 || r.status === 503) {
    return {
      status: 502,
      body: {
        error: `O Letterboxd recusou o pedido (HTTP ${r.status}). Costuma ser a proteção anti-bot; tenta de novo daqui a pouco.`,
        blocked: true
      }
    };
  }
  if (!r.ok) return { status: 502, body: { error: `O Letterboxd respondeu HTTP ${r.status}.` } };
  return null;
}

/* ---------- /api/films ---------- */

async function handleFilms(url, request) {
  const cookie = cookieFrom(request);
  if (cookie === null) return json({ error: 'Cookie inválido.' }, 400);
  const base = safePath(url.searchParams.get('path'));
  if (!base) return json({ error: 'Caminho inválido.' }, 400);
  const page = url.searchParams.get('page') || '1';
  const path = pathWithPage(base, page);
  if (!path) return json({ error: 'Página inválida.' }, 400);

  const r = await lbFetch(path, cookie);
  if (r.status === 404 && Number(page) > 1) return json({ films: [], hasNext: false, page: Number(page) });
  const bad = classify(r, !!cookie);
  if (bad) return json(bad.body, bad.status);
  const html = await r.text();
  return json({ films: parseFilms(html), hasNext: hasNext(html), page: Number(page) });
}

/* ---------- /api/lists ---------- */

async function handleLists(url, request) {
  const cookie = cookieFrom(request);
  if (cookie === null) return json({ error: 'Cookie inválido.' }, 400);
  const user = url.searchParams.get('user') || '';
  if (!/^[A-Za-z0-9_]{2,40}$/.test(user)) return json({ error: 'Username inválido.' }, 400);

  const lists = new Map();
  for (let p = 1; p <= 6; p++) {
    const path = p === 1 ? `/${user}/lists/` : `/${user}/lists/page/${p}/`;
    const r = await lbFetch(path, cookie);
    const bad = classify(r, !!cookie);
    if (bad) {
      if (p > 1 && bad.status === 404) break;
      return json(bad.body, bad.status);
    }
    const html = await r.text();
    for (const l of parseLists(html, user)) if (!lists.has(l.slug)) lists.set(l.slug, l);
    if (!hasNext(html)) break;
  }
  return json({ lists: [...lists.values()] });
}

/* ---------- /api/debug ---------- */

async function handleDebug(url, request) {
  const cookie = cookieFrom(request);
  if (cookie === null) return json({ error: 'Cookie inválido.' }, 400);
  const base = safePath(url.searchParams.get('path'));
  if (!base) return json({ error: 'Caminho inválido.' }, 400);
  const path = pathWithPage(base, url.searchParams.get('page') || '1');
  if (!path) return json({ error: 'Página inválida.' }, 400);

  const r = await lbFetch(path, cookie);
  const html = await r.text();
  const films = parseFilms(html);
  return json({
    requested: path,
    status: r.status,
    finalUrl: r.url,
    bytes: html.length,
    title: (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || null,
    filmsFound: films.length,
    approx: films.some(f => f.approx),
    firstFilms: films.slice(0, 3),
    hasNext: hasNext(html),
    sampleTags: filmTags(html).slice(0, 2).map(t => t.slice(0, 500)),
    looksLikeChallenge: /just a moment|cf-chl|challenge-platform/i.test(html)
  });
}

/* ---------- /api/login ---------- */

function collect(jar, resp) {
  const list = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [];
  for (const sc of list) {
    const [pair, ...attrs] = sc.split(';');
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expired = attrs.some(a => /^\s*max-age\s*=\s*0\s*$/i.test(a));
    if (expired || value === '') jar.delete(name); else jar.set(name, value);
  }
}

const cookieString = jar => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const stripTags = s => String(s).replace(/<[^>]*>/g, '').trim();

async function handleLogin(request) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  const code = String(b.code || '').trim();
  if (!username || !password || username.length > 200 || password.length > 500) {
    return json({ error: 'Falta o utilizador ou a password.' }, 400);
  }
  const blocked = {
    error: 'O Letterboxd recusou o pedido de login (proteção anti-bot). Usa a opção "Colar cookie" ou tenta mais tarde.',
    blocked: true
  };

  const jar = new Map();
  const r1 = await fetch(LB + '/sign-in/', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  collect(jar, r1);
  const html1 = await r1.text();
  if ([403, 429, 503].includes(r1.status)) return json(blocked, 502);

  let csrf = jar.get('com.xk72.webparts.csrf');
  if (!csrf) {
    const m = html1.match(/name=["']__csrf["'][^>]*value=["']([^"']+)["']/i) ||
              html1.match(/value=["']([^"']+)["'][^>]*name=["']__csrf["']/i);
    csrf = m && m[1];
  }
  if (!csrf) return json({ error: 'Não consegui obter o token CSRF do Letterboxd (o formulário pode ter mudado).' }, 502);
  if (!jar.has('com.xk72.webparts.csrf')) jar.set('com.xk72.webparts.csrf', csrf);

  const form = new URLSearchParams({ __csrf: csrf, username, password, remember: 'true' });
  if (code) form.set('authenticationCode', code);

  const r2 = await fetch(LB + '/user/login.do', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': LB,
      'Referer': LB + '/sign-in/',
      'Cookie': cookieString(jar)
    },
    body: form.toString()
  });
  collect(jar, r2);
  if ([403, 429, 503].includes(r2.status)) return json(blocked, 502);

  let data = null;
  try { data = await r2.json(); } catch { /* resposta não-JSON */ }
  if (!data || data.result !== 'success') {
    const msgs = Array.isArray(data && data.messages) ? data.messages.map(stripTags).filter(Boolean).join(' ') : '';
    const needCode = /authenticat|two[- ]?factor|2fa|verification code|security code/i.test(msgs);
    return json({
      error: msgs || 'Login recusado (utilizador/password errados?).',
      needCode
    }, 401);
  }

  const signedAs = jar.get('letterboxd.signed.in.as');
  return json({
    ok: true,
    username: signedAs ? decodeURIComponent(signedAs) : '',
    cookie: cookieString(jar)
  });
}
