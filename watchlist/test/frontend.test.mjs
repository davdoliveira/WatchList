// Testes do frontend (jsdom) com proxy e TMDB simulados.  Correr: npm run test:frontend
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const HTML = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n   ' + e.message); } };

// --- dados simulados ---
const LB = {
  '/david/watchlist/': { films: [
    { slug: 'amelie', name: 'Amélie', year: 2001 },
    { slug: 'dune-2021', name: 'Dune', year: 2021 },
    { slug: 'obscure', name: 'Filme Obscuro', year: 1999 }
  ], hasNext: false },
  '/films/popular/': { films: [{ slug: 'dune-2021', name: 'Dune', year: 2021 }], hasNext: true },
  '/david/watchlist/decade/2010s/by/rating/': { films: [{ slug: 'dune-2021', name: 'Dune', year: 2021 }], hasNext: false },
  '/serie/list/mista/': { films: [
    { slug: 'dune-2021', name: 'Dune', year: 2021 },
    { slug: 'chernobyl-2019', name: 'Chernobyl', year: 2019 }
  ], hasNext: false },
  '/david/films/': { films: [{ slug: 'amelie', name: 'Amélie', year: 2001 }], hasNext: false },
  '/vazia/list/x/': { films: [], hasNext: false }
};
const TMDB = {
  Amélie: { id: 194, title: 'O Fabuloso Destino de Amélie Poulain', original_title: 'Le Fabuleux Destin d\'Amélie Poulain', release_date: '2001-04-25', vote_count: 9000 },
  Dune: { id: 438631, title: 'Dune', original_title: 'Dune', release_date: '2021-09-15', vote_count: 12000 }
};
const TV = { Chernobyl: { id: 87108, name: 'Chernobyl', original_name: 'Chernobyl', first_air_date: '2019-05-06', vote_count: 8000 } };
const PROV = {
  87108: { flatrate: [{ provider_id: 1899, provider_name: 'Max', logo_path: '/m.jpg' }] },
  194: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }], rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/a.jpg' }] },
  438631: { flatrate: [{ provider_id: 1899, provider_name: 'Max', logo_path: '/m.jpg' }] }
};
const calls = [];

function makeFetch() {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href || input.url);
    calls.push({ url: url.toString(), headers: init.headers || {}, method: init.method || 'GET', body: init.body });
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (url.origin === 'https://app.test') {
      if (url.pathname === '/api/films') {
        const p = url.searchParams.get('path'), page = url.searchParams.get('page');
        if (p in LB) return J({ ...LB[p], page: +page });
        return J({ error: 'Página não encontrada no Letterboxd (404).', notFound: true }, 404);
      }
      if (url.pathname === '/api/lists') return J({ lists: [{ slug: 'x', title: 'Minha Lista', path: '/david/list/x/' }] });
      if (url.pathname === '/api/login') {
        const b = JSON.parse(init.body);
        if (b.password === 'bad') return J({ error: 'Invalid username or password.' }, 401);
        return J({ ok: true, username: 'david', cookie: 'letterboxd.user.CURRENT=S' });
      }
    }
    if (url.hostname === 'api.themoviedb.org') {
      if (url.pathname === '/3/trending/movie/week') {
        const pg = +url.searchParams.get('page');
        return J({ results: pg === 1 ? [{ id: 438631, title: 'Dune', original_title: 'Dune', release_date: '2021-09-15' }] : [], total_pages: 30 });
      }
      if (url.pathname === '/3/search/tv') {
        const q = url.searchParams.get('query');
        return J({ results: TV[q] ? [TV[q]] : [] });
      }
      const mt = url.pathname.match(/^\/3\/tv\/(\d+)$/);
      if (mt) {
        const id = +mt[1];
        return J({ id, name: 'Chernobyl', original_name: 'Chernobyl', first_air_date: '2019-05-06', episode_run_time: [65],
          vote_average: 8.7, poster_path: '/t.jpg', genres: [{ id: 2, name: 'Drama' }], 'watch/providers': { results: { PT: PROV[id] || {} } } });
      }
      if (url.pathname === '/3/search/movie') {
        const q = url.searchParams.get('query');
        return J({ results: TMDB[q] ? [TMDB[q]] : [] });
      }
      const m = url.pathname.match(/^\/3\/movie\/(\d+)$/);
      if (m) {
        const id = +m[1];
        const base = Object.values(TMDB).find(x => x.id === id) || { id, title: 'Manual', original_title: 'Manual', release_date: '2000-01-01' };
        return J({ ...base, runtime: 100 + (id % 50), vote_average: id === 194 ? 8.3 : 7.8, poster_path: '/p.jpg', genres: [{ id: 1, name: 'Drama' }],
          'watch/providers': { results: { PT: PROV[id] || {} } } });
      }
    }
    return J({ error: 'not mocked ' + url }, 500);
  };
}

async function boot({ settings, auth, prefs } = {}) {
  calls.length = 0;
  const dom = new JSDOM(HTML, {
    url: 'https://app.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = makeFetch();
      w.Response = Response; w.URL = URL;
      w.matchMedia = () => ({ matches: false });
      w.HTMLElement.prototype.scrollIntoView = () => {};
      if (settings) w.localStorage.setItem('lb_settings', JSON.stringify(settings));
      if (auth) w.localStorage.setItem('lb_auth', JSON.stringify(auth));
      if (prefs) w.localStorage.setItem('lb_prefs2', JSON.stringify(prefs));
    }
  });
  await sleep(600);
  return dom;
}
const $ = (dom, s) => dom.window.document.querySelector(s);
const $$ = (dom, s) => [...dom.window.document.querySelectorAll(s)];
const fire = (dom, el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
const cacheOf = dom => JSON.parse(dom.window.localStorage.getItem('lb_cache2'));
const lbPaths = () => calls.filter(c => c.url.includes('/api/films')).map(c => new URL(c.url).searchParams.get('path'));

console.log('--- A: token + utilizador, watchlist ---');
let dom = await boot({ settings: { token: 'x'.repeat(32), country: 'PT', accessKey: 'k1' }, auth: { username: 'david', cookie: 'c=1' } });
ok('lê a watchlist pelo proxy com cookie e chave de acesso', () => {
  const c = calls.find(c => c.url.includes('/api/films'));
  assert.ok(c, 'sem chamada a /api/films');
  assert.equal(new URL(c.url).searchParams.get('path'), '/david/watchlist/');
  assert.equal(c.headers['X-LB-Cookie'], 'c=1');
  assert.equal(c.headers['X-Access-Key'], 'k1');
});
ok('painel de conta fechado quando já há chave TMDB', () => assert.equal($(dom, '#menu').hidden, true));
ok('mostra 2 filmes (o "Obscuro" fica por identificar)', () => {
  assert.equal($$(dom, '.film').length, 2);
  assert.equal($(dom, '#unm').hidden, false);
  assert.match($(dom, '#unm').textContent, /Filme Obscuro/);
});
ok('serviços com contagem; aluguer não aparece por defeito', () => {
  const chips = $$(dom, '.svc[data-id]').map(c => c.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(chips.some(t => t.includes('Netflix') && t.includes('1')), chips.join('|'));
  assert.ok(chips.some(t => t.includes('Max')), chips.join('|'));
  assert.ok(!chips.some(t => t.includes('Apple')));
});
ok('filtrar por Netflix deixa só a Amélie e marca o serviço', () => {
  $(dom, '.svc[data-id="8"]').click();
  const cards = $$(dom, '.film');
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /Amélie/);
  assert.match($(dom, '#count').textContent, /1 de 3/);
  assert.equal($(dom, '.svc[data-id="8"]').getAttribute('aria-pressed'), 'true');
  assert.match($(dom, '#svcHint').textContent, /1 selecionado/);
});
ok('seleção persiste e "Limpar" repõe', () => {
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('lb_sel')), [8]);
  $(dom, '.svc[data-clear]').click();
  assert.equal($$(dom, '.film').length, 2);
});
ok('incluir aluguer/compra acrescenta Apple TV', () => {
  const cb = $(dom, '#rentbuy'); cb.checked = true; fire(dom, cb, 'change');
  assert.ok($$(dom, '.svc[data-id]').some(c => c.textContent.includes('Apple')));
});
ok('nota mínima filtra e o emblema dos filtros conta', () => {
  const r = $(dom, '#minRating'); r.value = '8'; fire(dom, r, 'change');
  assert.equal($$(dom, '.film').length, 1);
  assert.equal($(dom, '#fbadge').hidden, false);
  assert.equal($(dom, '#fbadge').textContent, '2');            // aluguer + nota
  assert.match($(dom, '#applyFilters').textContent, /Ver 1 filme$/);
});
ok('"Limpar filtros" repõe tudo', () => {
  $(dom, '#clearFilters').click();
  assert.equal($$(dom, '.film').length, 2);
  assert.equal($(dom, '#fbadge').hidden, true);
  assert.equal($(dom, '#minRating').value, '');
  assert.equal($(dom, '#rentbuy').checked, false);
});
ok('cache TMDB usa o slug como chave', () => {
  const c = cacheOf(dom);
  assert.ok(c['amelie'] && c['dune-2021'] && c['obscure'].unmatched);
});
ok('cartão mostra a nota no poster e a duração', () => {
  const t = $(dom, '.film').textContent;
  assert.match(t, /★/); assert.match(t, /\dh\d\d/);
});

console.log('--- B: painéis ---');
ok('o botão da conta abre e fecha o painel, com bloqueio de scroll', () => {
  $(dom, '#acctBtn').click();
  assert.equal($(dom, '#menu').hidden, false);
  assert.equal($(dom, '#backdrop').hidden, false);
  assert.ok(dom.window.document.body.classList.contains('lock'));
  assert.equal($(dom, '#acctBtn').getAttribute('aria-expanded'), 'true');
  $(dom, '#acctBtn').click();
  assert.equal($(dom, '#menu').hidden, true);
  assert.ok(!dom.window.document.body.classList.contains('lock'));
});
ok('Filtros abre a folha; Escape e fundo fecham', () => {
  $(dom, '#filtersBtn').click();
  assert.equal($(dom, '#sheet').hidden, false);
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($(dom, '#sheet').hidden, true);
  $(dom, '#filtersBtn').click();
  $(dom, '#backdrop').click();
  assert.equal($(dom, '#sheet').hidden, true);
});
ok('abrir um painel fecha o outro', () => {
  $(dom, '#filtersBtn').click();
  $(dom, '#acctBtn').click();
  assert.equal($(dom, '#sheet').hidden, true);
  assert.equal($(dom, '#menu').hidden, false);
  $(dom, '#backdrop').click();
});

console.log('--- C: filtros do Letterboxd montam o caminho ---');
{
  calls.length = 0;
  const d = $(dom, '#decade'); d.value = '2010s'; fire(dom, d, 'change');
  const s = $(dom, '#lbsort'); s.value = 'rating'; fire(dom, s, 'change');
  await sleep(700);
  ok('década + ordenação => /david/watchlist/decade/2010s/by/rating/', () => {
    assert.ok(lbPaths().includes('/david/watchlist/decade/2010s/by/rating/'), JSON.stringify(lbPaths()));
  });
  ok('resultado do Letterboxd substitui a lista', () => assert.equal($$(dom, '.film').length, 1));
  $(dom, '#clearFilters').click();
  await sleep(600);
  ok('depois de limpar volta a ter os 2 filmes', () => assert.equal($$(dom, '.film').length, 2));
}

console.log('--- D: listas, endereço personalizado, "Carregar mais" ---');
{
  const src = $(dom, '#source'); src.value = 'list'; fire(dom, src, 'change');
  await sleep(500);
  ok('origem "listas" mostra o seletor com as listas', () => {
    assert.match($(dom, '#listSel').innerHTML, /Minha Lista/);
    assert.equal($(dom, '#listWrap').hidden, false);
    assert.equal($(dom, '#subRow').hidden, false);
  });
  const src2 = $(dom, '#source'); src2.value = 'custom'; fire(dom, src2, 'change');
  calls.length = 0;
  const u = $(dom, '#customUrl'); u.value = 'https://letterboxd.com/films/popular/page/3/?x=1'; fire(dom, u, 'change');
  await sleep(500);
  ok('normaliza o endereço (remove /page/N/ e query)', () => assert.ok(lbPaths().includes('/films/popular/'), JSON.stringify(lbPaths())));
  ok('hasNext=true mostra "Carregar mais"', () => assert.equal($(dom, '#more').hidden, false));
  u.value = 'https://evil.com/x/'; fire(dom, u, 'change');
  await sleep(300);
  ok('rejeita domínios que não são letterboxd.com', () => assert.match($(dom, '#status').textContent, /letterboxd\.com/));
  u.value = 'https://letterboxd.com/vazia/list/x/'; fire(dom, u, 'change');
  await sleep(400);
  ok('página sem filmes diz-o e não mostra grelha nem diagnóstico', () => {
    assert.equal($(dom, '#status').textContent, 'Esta página não tem filmes.');
    assert.equal($$(dom, '.film').length, 0);
    assert.equal($(dom, '#diag'), null);
  });
  u.value = 'https://letterboxd.com/nada/aqui/'; fire(dom, u, 'change');
  await sleep(400);
  ok('404 mostra a mensagem do proxy', () => assert.match($(dom, '#status').textContent, /404/));
}

console.log('--- E: séries e "Corrigir" ---');
{
  const u = $(dom, '#customUrl'); u.value = 'https://letterboxd.com/serie/list/mista/'; fire(dom, u, 'change');
  await sleep(900);
  ok('série sem match de filme é encontrada via /search/tv', () => {
    const c = cacheOf(dom)['chernobyl-2019'];
    assert.equal(c.type, 'tv'); assert.equal(c.id, 87108); assert.equal(c.runtime, 65); assert.equal(c.year, 2019);
    assert.equal(c.prov.stream[0][1], 'Max');
  });
  ok('cartão da série aparece com a duração formatada', () => {
    const t = $$(dom, '.film').map(c => c.textContent).join('|');
    assert.match(t, /Chernobyl/); assert.match(t, /1h05/);
  });
  const prompts = ['https://www.themoviedb.org/tv/87108-chernobyl/season/1/episode/2', 'https://www.themoviedb.org/movie/438631-dune', 'lixo', '87108'];
  dom.window.prompt = () => prompts.shift();
  const alerts = []; dom.window.alert = m => alerts.push(m);
  await dom.window.fixFilm('chernobyl-2019');
  ok('corrigir com /tv/…/episode/… usa o endpoint de séries', () => {
    assert.ok(calls.some(c => c.url.includes('api.themoviedb.org/3/tv/87108')));
    assert.equal(cacheOf(dom)['chernobyl-2019'].type, 'tv');
  });
  await dom.window.fixFilm('chernobyl-2019');
  ok('corrigir com /movie/ muda para filme', () => {
    const c = cacheOf(dom)['chernobyl-2019'];
    assert.equal(c.type, 'movie'); assert.equal(c.id, 438631); assert.equal(c.manual, true);
  });
  await dom.window.fixFilm('chernobyl-2019');
  ok('texto sem número explica os formatos aceites', () => assert.match(alerts.at(-1), /themoviedb\.org\/tv\/123/));
  await dom.window.fixFilm('chernobyl-2019');
  ok('só o número tenta filme e depois série', () => {
    const c = cacheOf(dom)['chernobyl-2019'];
    assert.ok(c.id === 87108 || c.id === 438631);
  });
}

console.log('--- F: origens ---');
{
  const opts = $$(dom, '#source option').map(o => o.value);
  ok('só ficam as origens combinadas', () => assert.deepEqual(opts, ['watchlist', 'likes', 'watched', 'list', 'trending', 'custom']));
  const src = $(dom, '#source'); src.value = 'trending'; fire(dom, src, 'change');
  calls.length = 0;
  await sleep(700);
  ok('"Em alta" não chama o proxy do Letterboxd e esconde os filtros do Letterboxd', () => {
    assert.ok(!calls.some(c => c.url.includes('/api/films')));
    assert.equal($(dom, '#lbGroup').hidden, true);
  });
  ok('usa o id do TMDB sem pesquisar por título e liga ao TMDB', () => {
    assert.ok(calls.some(c => c.url.includes('/3/trending/movie/week')));
    assert.ok(!calls.some(c => c.url.includes('/3/search/')));
    assert.equal($(dom, '.film .poster').getAttribute('href'), 'https://www.themoviedb.org/movie/438631');
  });
  ok('há mais páginas => "Carregar mais"', () => assert.equal($(dom, '#more').hidden, false));
}

console.log('--- G: esconder vistos e estado vazio ---');
{
  const src = $(dom, '#source'); src.value = 'watchlist'; fire(dom, src, 'change');
  await sleep(500);
  const hw = $(dom, '#hideWatched'); hw.checked = true; fire(dom, hw, 'change');
  await sleep(500);
  ok('a Amélie (vista) desaparece', () => {
    const t = $$(dom, '.film').map(c => c.textContent).join('|');
    assert.ok(!t.includes('Amélie'), t); assert.ok(t.includes('Dune'));
  });
  const r = $(dom, '#minRating'); r.value = '9.5'; fire(dom, r, 'change');
  ok('sem resultados mostra o estado vazio com ação', () => {
    assert.equal($$(dom, '.film').length, 0);
    assert.match($(dom, '#grid').textContent, /Nenhum filme passa nestes filtros/);
    assert.ok($(dom, '[data-reset]'));
  });
  $(dom, '[data-reset]').click();
  await sleep(300);
  ok('"Limpar filtros e serviços" repõe a lista', () => assert.ok($$(dom, '.film').length >= 1));
}

console.log('--- H: conta ---');
dom = await boot({ settings: { token: 'x'.repeat(32), country: 'PT', accessKey: '' } });
ok('sem conta: usa "Em alta" por defeito e o painel fica fechado', () => {
  assert.equal($(dom, '#source').value, 'trending');
  assert.equal($(dom, '#menu').hidden, true);
});
{
  $(dom, '#acctBtn').click();
  $(dom, '#lu').value = 'david'; $(dom, '#lp').value = 'bad';
  $(dom, '#doLogin').click(); await sleep(300);
  ok('password errada mostra o erro e não guarda sessão', () => {
    assert.match($(dom, '#acctMsg').textContent, /Invalid username/);
    assert.equal(dom.window.localStorage.getItem('lb_auth'), null);
  });
  $(dom, '#lp').value = 'good';
  $(dom, '#doLogin').click(); await sleep(600);
  ok('login ok guarda o cookie, mostra o avatar e passa para a watchlist', () => {
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('lb_auth')), { username: 'david', cookie: 'letterboxd.user.CURRENT=S' });
    assert.equal($(dom, '#acctBtn .avatar').textContent, 'D');
    assert.match($(dom, '#acctStatus').textContent, /Sessão iniciada/);
    assert.equal($(dom, '#acctForms').hidden, true);
    assert.equal($(dom, '#source').value, 'watchlist');
    assert.ok(!dom.window.localStorage.getItem('lb_settings')?.includes('good'));
    assert.equal($(dom, '#lp').value, '');
  });
  $(dom, '#logout').click(); await sleep(300);
  ok('sair limpa a sessão e volta a "Em alta"', () => {
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('lb_auth')), { username: '', cookie: '' });
    assert.equal($(dom, '#source').value, 'trending');
    assert.equal($(dom, '#acctForms').hidden, false);
  });
  $(dom, '[data-mode="cookie"]').click();
  ok('separador "Cookie" mostra o formulário certo', () => {
    assert.equal($(dom, '[data-form="cookie"]').hidden, false);
    assert.equal($(dom, '[data-form="login"]').hidden, true);
  });
}
dom = await boot();
ok('primeira utilização (sem chave TMDB): abre o painel de definições', () => {
  assert.equal($(dom, '#menu').hidden, false);
  assert.match($(dom, '#status').textContent, /chave do TMDB/);
});
{
  $(dom, '#token').value = 'y'.repeat(32);
  $(dom, '#saveSettings').click(); await sleep(700);
  ok('guardar a chave fecha o painel e carrega a lista', () => {
    assert.equal($(dom, '#menu').hidden, true);
    assert.ok($$(dom, '.film').length >= 1);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('lb_settings')).token, 'y'.repeat(32));
  });
}
dom = await boot({ settings: { token: 'x'.repeat(32), country: 'PT', accessKey: '' }, prefs: { source: 'week' } });
ok('origem antiga guardada ("week") cai para uma origem válida', () => assert.equal($(dom, '#source').value, 'trending'));

console.log('--- I: vista só capas ---');
const SET = { token: 'x'.repeat(32), country: 'PT', accessKey: '' };
const AUTH = { username: 'david', cookie: 'c=1' };
dom = await boot({ settings: SET, auth: AUTH });
ok('por defeito: vista com detalhes, sem slider', () => {
  assert.equal($(dom, '#grid').classList.contains('covers'), false);
  assert.equal($(dom, '#colsRow').hidden, true);
  assert.equal($(dom, '#viewDetail').getAttribute('aria-pressed'), 'true');
  assert.ok($(dom, '.film h3'));
});
$(dom, '#viewCovers').click();
ok('capas: grelha com 4 colunas, sem texto, sem nota, sem Corrigir', () => {
  const g = $(dom, '#grid');
  assert.ok(g.classList.contains('covers'));
  assert.equal(g.style.getPropertyValue('--cols'), '4');
  assert.equal($(dom, '#colsRow').hidden, false);
  assert.equal($$(dom, '.film').length, 2);
  assert.equal($(dom, '.film h3'), null);
  assert.equal($(dom, '.rate'), null);
  assert.equal($(dom, '.fix'), null);
  assert.ok($(dom, '.film .poster').getAttribute('aria-label'));
  assert.equal($(dom, '#viewCovers').getAttribute('aria-pressed'), 'true');
});
{
  const r = $(dom, '#cols'); r.value = '6';
  fire(dom, r, 'input');
  ok('mexer no slider muda --cols e o número mostrado', () => {
    assert.equal($(dom, '#grid').style.getPropertyValue('--cols'), '6');
    assert.match($(dom, '#colsOut').textContent, /6/);
  });
  fire(dom, r, 'change');
  ok('soltar o slider guarda e usa imagens mais pequenas (w185)', () => {
    assert.equal(JSON.parse(dom.window.localStorage.getItem('lb_prefs2')).cols, 6);
    assert.equal(JSON.parse(dom.window.localStorage.getItem('lb_prefs2')).view, 'covers');
    assert.match($(dom, '.film img').src, /\/w185\//);
  });
}
ok('ao acaso funciona nas capas', () => { $(dom, '#surprise').click(); assert.equal($$(dom, '.film.pick').length, 1); });
$(dom, '#viewDetail').click();
ok('voltar a detalhes repõe títulos e esconde o slider', () => {
  assert.ok($(dom, '.film h3'));
  assert.equal($(dom, '#colsRow').hidden, true);
  assert.equal($(dom, '#grid').style.getPropertyValue('--cols'), '');
});
dom = await boot({ settings: SET, auth: AUTH, prefs: { view: 'covers', cols: 3 } });
ok('preferência guardada: abre em capas com 3 colunas', () => {
  assert.ok($(dom, '#grid').classList.contains('covers'));
  assert.equal($(dom, '#grid').style.getPropertyValue('--cols'), '3');
  assert.equal($(dom, '#cols').value, '3');
});
dom = await boot({ settings: SET, auth: AUTH, prefs: { view: 'covers', cols: 99 } });
ok('valor inválido guardado volta ao padrão (4)', () => assert.equal($(dom, '#grid').style.getPropertyValue('--cols'), '4'));
console.log(failed ? `\n${failed} FALHAS, ${passed} ok` : `\ntodos os ${passed} testes de frontend passaram`);
process.exit(failed ? 1 : 0);
