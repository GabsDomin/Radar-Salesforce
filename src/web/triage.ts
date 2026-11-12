// Triagem: um lead por vez, do maior para o menor score, para decidir rápido.
// Atalhos: A aprova, D descarta, S adia, J pula, K volta, O abre o lead.
import type { getCompany } from './queries.ts';
import { esc, layout, fmtDate, scoreClass, decisionButtons, extLink } from './views.ts';

type LeadDetail = NonNullable<ReturnType<typeof getCompany>>;

const SECTOR_LABEL: Record<string, string> = { industria: 'Indústria', financeiro: 'Serv. financeiros', agro: 'Agronegócio' };

function card(d: LeadDetail, i: number): string {
  const c = d.company;
  const why = d.breakdown.filter((b) => b.points > 0).sort((a, b) => b.points - a.points).slice(0, 4);
  const signals = d.signals.slice(0, 3);
  const place = esc([c.city, c.state].filter(Boolean).join(' / ')) || 'local não informado';
  return `<section class="card triage" data-id="${c.id}"${i ? ' hidden' : ''}>
  <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
    <div><div class="big score ${scoreClass(c.total)}">${c.total ?? '—'}</div><div class="small muted">nota</div></div>
    <div style="flex:1;min-width:220px"><h2 style="margin:0;font-size:22px">${esc(c.name)}</h2>
      <div class="small muted">${place}${c.sector ? ' · ' + esc(SECTOR_LABEL[c.sector] ?? c.sector) : ''}</div>
      <div style="margin-top:6px">${d.offers.map((o) => `<span class="chip offer">${esc(o.offer)}</span>`).join('') || '<span class="small muted">sem oferta sugerida</span>'}</div></div>
  </div>
  <div class="cols" style="margin-top:14px">
    <div><h2>Por que entrou</h2>${why.map((b) => `<div class="bd-row"><div class="bd-pts">+${b.points}</div><div><strong>${esc(b.rule)}</strong><div class="small">${esc(b.reason)}</div></div></div>`).join('') || '<p class="small muted">Sem pontos positivos.</p>'}</div>
    <div><h2>Evidências</h2>${signals.map((s) => `<div class="signal">${extLink(s.url, `<strong>${esc(s.title)}</strong>`)}
      ${s.evidence ? `<div class="evidence">${esc(s.evidence)}</div>` : ''}<div class="small muted">${esc(s.source)} · ${fmtDate(s.published_at ?? s.collected_at)}</div></div>`).join('') || '<p class="small muted">Sem sinais.</p>'}
      ${d.signals.length > 3 ? `<p class="small"><a href="/empresa/${c.id}">+ ${d.signals.length - 3} evidência(s)</a></p>` : ''}</div>
  </div>
  <div class="decision">${decisionButtons(c.id, c.status)}
    <a class="btn secondary" href="/empresa/${c.id}" data-open>Abrir lead</a></div>
</section>`;
}

const TRIAGE_SCRIPT = `<script>
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll('section.triage'));
  var i = 0, pos = document.getElementById('pos'), tot = document.getElementById('tot');
  function show(n) {
    cards.forEach(function (c) { c.hidden = true; });
    if (!cards.length) { document.getElementById('done').hidden = false; pos.textContent = 0; tot.textContent = 0; return; }
    i = (n + cards.length) % cards.length;
    cards[i].hidden = false; pos.textContent = i + 1; tot.textContent = cards.length;
  }
  document.addEventListener('radar:decided', function (e) {
    var idx = cards.findIndex(function (c) { return c.dataset.id === e.detail.id; });
    if (idx < 0) return;
    cards[idx].remove(); cards.splice(idx, 1);
    show(idx >= cards.length ? 0 : idx);
  });
  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    var cur = cards[i]; if (!cur) return;
    var k = e.key.toLowerCase(), act = { a: 'aprovar', d: 'descartar', s: 'adiar' }[k];
    if (act) { var b = cur.querySelector('[data-decide="' + act + '"]'); if (b) { e.preventDefault(); b.click(); } }
    else if (k === 'j') show(i + 1);
    else if (k === 'k') show(i - 1);
    else if (k === 'o') location.href = cur.querySelector('[data-open]').href;
  });
  show(0);
})();
</script>`;

export function triagePage(leads: LeadDetail[], pending: number): string {
  return layout('Triagem · Radar', `
<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
  <div><h2 style="margin:0;font-size:18px">Triagem</h2>
    <div class="small muted">Decida lead por lead: aprovar (vale abordar), descartar (com motivo) ou adiar.
      Atalhos: <kbd>A</kbd> aprovar · <kbd>D</kbd> descartar · <kbd>S</kbd> adiar · <kbd>J</kbd> pular · <kbd>K</kbd> voltar · <kbd>O</kbd> abrir</div></div>
  <div class="small"><strong id="pos">${leads.length ? 1 : 0}</strong> de <strong id="tot">${leads.length}</strong>${pending > leads.length ? ` <span class="muted">(mostrando os ${leads.length} primeiros de ${pending})</span>` : ''}</div>
</div>
${leads.map(card).join('')}
<div class="card" id="done"${leads.length ? ' hidden' : ''}><h2>Nada para triar agora</h2>
  <p class="small muted">Todos os leads novos já foram decididos. Veja os <a href="/?visao=aprovadas">aprovados</a> ou <a href="/atualizar">busque novos sinais</a>.</p></div>
${TRIAGE_SCRIPT}`);
}
