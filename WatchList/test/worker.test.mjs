// Testes sem rede: parser + worker com fetch simulado.  Correr: npm test
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { parseFilms, parseLists, hasNext, decode } from '../src/parse.js';

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e.stack || e)); process.exitCode = 1; }
}

/* ---------- fixtures ---------- */
const OLD_MARKUP = `
<ul class="poster-list -p125 -grid">
 <li class="poster-container" data-owner-rating="8">
  <div class="react-component poster film-poster" data-component-class="LazyPoster" data-film-id="51818"
       data-film-name="Amélie" data-film-slug="amelie" data-film-release-year="2001"
       data-target-link="/film/amelie/"></div>
 </li>
 <li class="poster-container">
  <div class="react-component poster film-poster" data-component-class="LazyPoster" data-film-id="1"
       data-film-name="Tom &amp; Jerry: The Movie" data-film-slug="tom-jerry-the-movie" data-film-release-year="1992"></div>
 </li>
</ul>
<div class="pagination"><div class="paginate-nextprev"><a class="next" href="/david/watchlist/page/2/">Older</a></div></div>`;

const NEW_MARKUP = `
<ul class="grid -p70">
 <li class="posteritem"><div class="react-component" data-component-class="LazyPoster"
   data-item-name="Dune (2021)" data-item-slug="dune-2021" data-item-link="/film/dune-2021/" data-film-id="437"></div></li>
 <li class="posteritem"><div class="react-component" data-component-class="LazyPoster"
   data-item-name="2001: A Space Odyssey (1968)" data-item-slug="2001-a-space-odyssey" data-item-link="/film/2001-a-space-odyssey/"></div></li>
 <li class="posteritem"><div class="react-component" data-item-name="Uma lista (2024)" data-item-slug="uma-lista" data-item-link="/david/list/uma-lista/"></div></li>
</ul>
<div class="pagination"><div class="paginate-nextprev paginate-disabled"><span class="next">Older</span></div></div>`;

const LISTS_PAGE = `
<section class="list"><h2 class="title-2 prettify"><a href="/david/list/best-of-2023/">Best of 2023</a></h2></section>
<section class="list"><h2 class="title-2"><a href="/david/list/filmes-para-ver-com-a-mae/">Filmes &amp; mãe</a></h2></section>
<a href="/david/list/best-of-2023/">12 films</a>
<a href="/david/list/sem-titulo-visivel/"><img></a>`;

/* ---------- parser ---------- */
await t('decode entidades', () => {
  assert.equal(decode('Tom &amp; Jerry &#039;x&#039; &#x27;y&#x27; &quot;z&quot;'), `Tom & Jerry 'x' 'y' "z"`);
});

await t('markup antigo (data-film-*)', () => {
  const f = parseFilms(OLD_MARKUP);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { slug: 'amelie', name: 'Amélie', year: 2001, id: 51818 });
  assert.equal(f[1].name, 'Tom & Jerry: The Movie');
  assert.equal(f[1].year, 1992);
});

await t('markup novo (data-item-*): ano no nome e listas ignoradas', () => {
  const f = parseFilms(NEW_MARKUP);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { slug: 'dune-2021', name: 'Dune', year: 2021, id: 437 });
  assert.equal(f[1].name, '2001: A Space Odyssey');
  assert.equal(f[1].year, 1968);
});

await t('plano B só com links /film/slug/', () => {
  const f = parseFilms('<a href="/film/blade-runner-2049/">x</a><a href="/film/amelie/">y</a><a href="/film/amelie/">dup</a>');
  assert.equal(f.length, 2);
  assert.equal(f[0].name, 'Blade Runner');
  assert.equal(f[0].year, 2049);
  assert.equal(f[0].slug, 'blade-runner-2049');
  assert.ok(f[0].approx);
  assert.equal(f[1].year, 0);
});

await t('lista de outro utilizador: link /user/film/slug/ e URL absoluto', () => {
  const html = `<ul class="poster-list">
    <li class="poster-container"><div class="film-poster" data-film-id="9" data-film-name="Stalker" data-film-slug="stalker"
       data-film-release-year="1979" data-target-link="/david/film/stalker/"></div></li>
    <li class="posteritem"><div class="react-component" data-item-name="Solaris (1972)" data-item-slug="solaris"
       data-item-link="https://letterboxd.com/film/solaris/"></div></li>
    <li class="posteritem"><div data-item-name="Outra lista" data-item-slug="outra" data-item-link="/david/list/outra/"></div></li>
  </ul>`;
  const f = parseFilms(html);
  assert.deepEqual(f.map(x => x.slug), ['stalker', 'solaris']);
  assert.equal(f[1].name, 'Solaris');
  assert.equal(f[1].year, 1972);
});

await t('elementos que não são div/li (figure, componentes) também servem', () => {
  const f = parseFilms('<figure data-item-slug="seven" data-item-name="Se7en (1995)" data-item-link="/film/seven/"></figure>');
  assert.equal(f.length, 1);
  assert.equal(f[0].name, 'Se7en');
});

await t('plano B apanha /user/film/slug/ e data-*link', () => {
  const f = parseFilms('<a href="/david/film/ran/">x</a><div data-target-link="/film/high-and-low/"></div>');
  assert.deepEqual(f.map(x => x.slug), ['ran', 'high-and-low']);
  assert.ok(f.every(x => x.approx));
});

await t('sem duplicados', () => {
  assert.equal(parseFilms(OLD_MARKUP + OLD_MARKUP).length, 2);
});

await t('paginação (a.next ativo vs span.next desativado)', () => {
  assert.equal(hasNext(OLD_MARKUP), true);
  assert.equal(hasNext(NEW_MARKUP), false);
});

await t('listas do utilizador', () => {
  const l = parseLists(LISTS_PAGE, 'david');
  assert.deepEqual(l.map(x => x.slug), ['best-of-2023', 'filmes-para-ver-com-a-mae', 'sem-titulo-visivel']);
  assert.equal(l[0].title, 'Best of 2023');
  assert.equal(l[1].title, 'Filmes & mãe');
  assert.equal(l[0].path, '/david/list/best-of-2023/');
  assert.equal(l[2].title, 'Sem Titulo Visivel');
});

/* ---------- worker (fetch simulado) ---------- */
const realFetch = globalThis.fetch;
let calls = [];
function mockFetch(routes) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url, method, headers: init.headers || {}, body: init.body });
    for (const [pattern, handler] of routes) {
      if (url.includes(pattern.path) && (pattern.method || 'GET') === method) return handler({ url, init });
    }
    return new Response('not mocked: ' + url, { status: 500 });
  };
}
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
const call = (path, opts = {}, env = {}) => worker.fetch(new Request('https://app.test' + path, opts), env);

await t('acesso: sem chave => 401 quando ACCESS_KEY existe; com chave => ok', async () => {
  const env = { ACCESS_KEY: 'segredo' };
  let r = await call('/api/ping', {}, env);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).needAccessKey, true);
  r = await call('/api/ping', { headers: { 'X-Access-Key': 'errada' } }, env);
  assert.equal(r.status, 401);
  r = await call('/api/ping', { headers: { 'X-Access-Key': 'segredo' } }, env);
  assert.equal(r.status, 200);
  r = await call('/api/ping', {}, {}); // sem ACCESS_KEY definida
  assert.equal(r.status, 200);
});

await t('ficheiros estáticos vão para ASSETS', async () => {
  const env = { ASSETS: { fetch: async () => new Response('<html>app</html>') } };
  const r = await call('/', {}, env);
  assert.equal(await r.text(), '<html>app</html>');
});

await t('/api/films: devolve filmes e hasNext; envia cookie; página 2 usa /page/2/', async () => {
  calls = [];
  mockFetch([[{ path: '/david/watchlist/page/2/' }, () => html(NEW_MARKUP)], [{ path: '/david/watchlist/' }, () => html(OLD_MARKUP)]]);
  let r = await call('/api/films?path=/david/watchlist/&page=1', { headers: { 'X-LB-Cookie': 'a=b' } });
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.films.length, 2);
  assert.equal(d.hasNext, true);
  assert.equal(calls[0].url, 'https://letterboxd.com/david/watchlist/');
  assert.equal(calls[0].headers.Cookie, 'a=b');
  r = await call('/api/films?path=/david/watchlist/&page=2');
  d = await r.json();
  assert.equal(calls.at(-1).url, 'https://letterboxd.com/david/watchlist/page/2/');
  assert.equal(d.films[0].slug, 'dune-2021');
  assert.equal(d.hasNext, false);
});

await t('/api/films: caminhos perigosos são recusados (sem pedido ao Letterboxd)', async () => {
  calls = [];
  mockFetch([]);
  for (const p of ['https://evil.com/', '//evil.com/x', '/../etc/passwd', '/user/logout/', '/x?y=1', '/a/b\\c']) {
    const r = await call('/api/films?path=' + encodeURIComponent(p));
    assert.equal(r.status, 400, p);
  }
  assert.equal((await call('/api/films?path=/ok/&page=0')).status, 400);
  assert.equal((await call('/api/films?path=/ok/&page=999')).status, 400);
  assert.equal(calls.length, 0);
});

await t('/api/films: cookie demasiado grande é recusado; cookie normal passa', async () => {
  mockFetch([[{ path: '/ok/' }, () => html(OLD_MARKUP)]]);
  let r = await call('/api/films?path=/ok/', { headers: { 'X-LB-Cookie': 'a'.repeat(4001) } });
  assert.equal(r.status, 400);
  r = await call('/api/films?path=/ok/', { headers: { 'X-LB-Cookie': 'a=b' } });
  assert.equal(r.status, 200);
});

await t('/api/films: 404, bloqueio 403 e redirecionamento para sign-in', async () => {
  mockFetch([[{ path: '/nada/' }, () => html('nope', 404)]]);
  let r = await call('/api/films?path=/nada/');
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /inicia sessão/);

  mockFetch([[{ path: '/blk/' }, () => html('Just a moment', 403)]]);
  r = await call('/api/films?path=/blk/');
  assert.equal(r.status, 502);
  assert.equal((await r.json()).blocked, true);

  mockFetch([[{ path: '/priv/' }, () => {
    const resp = html('login');
    Object.defineProperty(resp, 'url', { value: 'https://letterboxd.com/sign-in/?redirect=/priv/' });
    return resp;
  }]]);
  r = await call('/api/films?path=/priv/');
  assert.equal(r.status, 401);
  assert.equal((await r.json()).needLogin, true);
});

await t('/api/films: página sem filmes devolve lista vazia (sem diagnóstico, sem pedidos extra)', async () => {
  calls = [];
  mockFetch([[{ path: '/films/popular/this/week/' }, () => html('<html><body>sem grelha</body></html>')]]);
  const d = await (await call('/api/films?path=/films/popular/this/week/')).json();
  assert.deepEqual(d, { films: [], hasNext: false, page: 1 });
  assert.equal(calls.length, 1);
});

await t('/api/films: página >1 inexistente = fim, não erro', async () => {
  mockFetch([[{ path: '/fim/page/9/' }, () => html('x', 404)]]);
  const r = await call('/api/films?path=/fim/&page=9');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { films: [], hasNext: false, page: 9 });
});

await t('/api/lists: junta páginas e remove duplicados', async () => {
  mockFetch([[{ path: '/david/lists/' }, () => html(LISTS_PAGE)]]);
  const r = await call('/api/lists?user=david');
  const d = await r.json();
  assert.equal(d.lists.length, 3);
  assert.equal((await call('/api/lists?user=../x')).status, 400);
});

await t('/api/login: sucesso devolve cookie e username; password não é devolvida', async () => {
  calls = [];
  const csrfHeaders = new Headers();
  csrfHeaders.append('set-cookie', 'com.xk72.webparts.csrf=TOKEN123; Path=/; Secure');
  mockFetch([
    [{ path: '/sign-in/' }, () => new Response('<form></form>', { status: 200, headers: csrfHeaders })],
    [{ path: '/user/login.do', method: 'POST' }, () => {
      const h = new Headers({ 'content-type': 'application/json' });
      h.append('set-cookie', 'letterboxd.user.CURRENT=SESS; Path=/; HttpOnly');
      h.append('set-cookie', 'letterboxd.signed.in.as=david; Path=/');
      return new Response(JSON.stringify({ result: 'success' }), { status: 200, headers: h });
    }]
  ]);
  const r = await call('/api/login', { method: 'POST', body: JSON.stringify({ username: 'david', password: 'p@ss word' }) });
  const text = await r.text();
  const d = JSON.parse(text);
  assert.equal(r.status, 200);
  assert.equal(d.username, 'david');
  assert.match(d.cookie, /letterboxd\.user\.CURRENT=SESS/);
  assert.match(d.cookie, /com\.xk72\.webparts\.csrf=TOKEN123/);
  assert.ok(!text.includes('p@ss'));
  const post = calls.find(c => c.method === 'POST');
  const form = new URLSearchParams(post.body);
  assert.equal(form.get('__csrf'), 'TOKEN123');
  assert.equal(form.get('username'), 'david');
  assert.equal(form.get('password'), 'p@ss word');
  assert.equal(post.headers.Cookie, 'com.xk72.webparts.csrf=TOKEN123');
});

await t('/api/login: password errada e pedido de 2FA', async () => {
  const csrfHeaders = new Headers(); csrfHeaders.append('set-cookie', 'com.xk72.webparts.csrf=T; Path=/');
  const sign = [{ path: '/sign-in/' }, () => new Response('', { status: 200, headers: csrfHeaders })];
  mockFetch([sign, [{ path: '/user/login.do', method: 'POST' }, () =>
    new Response(JSON.stringify({ result: 'error', messages: ['<p>Invalid username or password.</p>'] }), { status: 200 })]]);
  let r = await call('/api/login', { method: 'POST', body: JSON.stringify({ username: 'a', password: 'b' }) });
  let d = await r.json();
  assert.equal(r.status, 401);
  assert.equal(d.error, 'Invalid username or password.');
  assert.equal(d.needCode, false);

  mockFetch([sign, [{ path: '/user/login.do', method: 'POST' }, () =>
    new Response(JSON.stringify({ result: 'error', messages: ['Please enter your two-factor authentication code.'] }), { status: 200 })]]);
  r = await call('/api/login', { method: 'POST', body: JSON.stringify({ username: 'a', password: 'b' }) });
  d = await r.json();
  assert.equal(d.needCode, true);
});

await t('/api/login: bloqueio anti-bot e campos em falta', async () => {
  mockFetch([[{ path: '/sign-in/' }, () => html('Just a moment', 403)]]);
  let r = await call('/api/login', { method: 'POST', body: JSON.stringify({ username: 'a', password: 'b' }) });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).blocked, true);
  r = await call('/api/login', { method: 'POST', body: JSON.stringify({ username: 'a' }) });
  assert.equal(r.status, 400);
  r = await call('/api/login'); // GET
  assert.equal(r.status, 405);
});

await t('/api/debug: relatório do que o scraper vê', async () => {
  mockFetch([[{ path: '/films/popular/this/week/' }, () => html('<title>Popular</title>' + NEW_MARKUP)]]);
  const r = await call('/api/debug?path=/films/popular/this/week/');
  const d = await r.json();
  assert.equal(d.filmsFound, 2);
  assert.equal(d.title, 'Popular');
  assert.ok(d.sampleTags.length >= 1);
  assert.equal(d.looksLikeChallenge, false);
});

globalThis.fetch = realFetch;
console.log(`\n${passed} testes passaram` + (process.exitCode ? ' (há falhas acima)' : ''));
