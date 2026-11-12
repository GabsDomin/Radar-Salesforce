// Páginas do dashboard e da central de atualização.
import type { DashboardData } from './dashboard.ts';
import type { UpdateState } from './jobs.ts';
import { esc, layout, fmtDate, scoreClass, ROLE_LABEL, leadTabs, extLink } from './views.ts';
import { MODALITIES, type ModalityInfo, type ModalityRow } from './modalities.ts';
import { STEP_LABEL, type StepId } from '../pipeline/update.ts';

const STAGE_LABEL: Record<string, string> = {
  radar: 'Radar', aprovada: 'Aprovada', abordagem: 'Em abordagem', respondeu: 'Respondeu', reuniao: 'Reunião',
  proposta: 'Proposta', ganha: 'Ganha', perdida: 'Perdida',
};
export const SUBTYPE_LABEL: Record<string, string> = { ...ROLE_LABEL };
const KIND_LABEL: Record<string, string> = { lideranca: 'Liderança', fusao: 'Fusão/aquisição', investimento: 'Investimento', expansao: 'Expansão' };

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

function bars(items: { label: string; count: number }[]): string {
  const max = Math.max(1, ...items.map((i) => i.count));
  return items.map((i) => `
<div class="bar-row"><span>${esc(i.label)}</span>
  <span class="bar-track" role="img" aria-label="${esc(i.label)}: ${i.count}"><span class="bar-fill" style="display:block;width:${(i.count / max) * 100}%"></span></span>
  <span class="bar-val">${i.count}</span></div>`).join('') || '<p class="muted small">Sem dados.</p>';
}

export function dashboardPage(d: DashboardData, isStatic = false): string {
  const t = d.totals;
  const kpi = (n: number, l: string, href?: string) => href
    ? `<a class="kpi" href="${href}" style="text-decoration:none;color:inherit"><div class="n">${n}</div><div class="l">${esc(l)} →</div></a>`
    : `<div class="kpi"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
  const q = d.queue;
  const work = isStatic ? '' : `
<h2 style="margin:0 0 10px">Seu trabalho</h2>
<div class="kpis">
  ${kpi(q.triagem, 'leads a triar', '/triagem')}
  ${kpi(q.aprovadas, 'aprovados', '/?visao=aprovadas')}
  ${kpi(q.adiadas, 'adiados', '/?visao=adiadas')}
  ${kpi(d.nextActions.filter((a) => a.due <= 7).length, 'ações nos próximos 7 dias')}
</div>`;
  return layout('Dashboard · Radar', `${work}
<h2 style="margin:0 0 10px">Radar</h2>
<div class="kpis">
  ${kpi(t.accounts, 'leads no radar', '/')}
  ${kpi(t.hot, 'leads quentes (nota ≥ 50)')}
  ${kpi(t.newLast7, 'novos nos últimos 7 dias')}
  ${kpi(t.withPain, 'com indício de dor', '/radar/dor')}
  ${kpi(t.withTrigger, 'com gatilho em 90 dias', '/radar/gatilhos')}
  ${kpi(t.excluded, 'excluídos (cliente, concorrente)')}
</div>
<h2 style="margin:0 0 10px">Leads por modalidade</h2>
<div class="kpis">
${MODALITIES.map((m) => { const c = d.modalities[m.id]; return `<a class="kpi" href="/radar/${m.id}" style="text-decoration:none;color:inherit"><div class="n">${c.total}</div><div class="l"><strong>${esc(m.label)}</strong> · ${c.companies} empresa(s) · ${c.recent} nos últimos 30 dias</div></a>`; }).join('')}
</div>
<div class="cols">
  <div class="card"><h2>Distribuição das notas</h2>${bars(d.scoreBuckets)}</div>
  <div class="card"><h2>Por setor</h2>${bars(d.bySector)}</div>
  <div class="card"><h2>Oferta sugerida</h2>${bars(d.byOffer)}<p class="muted small">Um lead pode ter mais de uma oferta.</p></div>
  <div class="card"><h2>Sinais por fonte</h2>${bars(d.bySource)}</div>
</div>
<div class="cols" style="margin-top:16px">
  <div class="card"><h2>Melhores leads</h2>
    ${d.topAccounts.map((a) => `<div class="bd-row" style="grid-template-columns:44px 1fr"><div class="score ${a.total >= 50 ? 'hi' : a.total >= 30 ? 'mid' : 'lo'}">${a.total}</div>
      <div><a href="/empresa/${a.id}"><strong>${esc(a.name)}</strong></a> ${a.offers.map((o) => `<span class="chip offer">${esc(o)}</span>`).join('')}
      <div class="small muted">${esc(a.why)}</div></div></div>`).join('') || '<p class="muted small">Sem leads ainda.</p>'}
    <p class="small"><a href="/">Ver todos →</a></p></div>
  <div class="card"><h2>Próximas ações</h2>
    ${d.nextActions.map((a) => `<div class="signal"><a href="/empresa/${a.id}"><strong>${esc(a.name)}</strong></a>
      <span class="small ${a.due < 0 ? 'run-bad' : 'muted'}">${a.due < 0 ? `atrasada ${-a.due} dia(s)` : a.due === 0 ? 'hoje' : `em ${a.due} dia(s)`}</span>
      <div class="small">${esc(a.next_action ?? '')}</div></div>`).join('') || '<p class="muted small">Nenhuma próxima ação marcada. Defina na página do lead.</p>'}</div>
  <div class="card"><h2>Decisões</h2>
    ${bars([{ label: 'Aprovados', count: q.aprovadas }, { label: 'Descartados', count: q.descartadas }, { label: 'Adiados', count: q.adiadas }])}
    ${d.discardReasons.length ? `<h2 style="margin-top:12px">Motivos de descarte</h2>${bars(d.discardReasons)}<p class="small muted">Use isso para ajustar o radar: muitos “fora do perfil” indicam regras a calibrar.</p>` : ''}</div>
  <div class="card"><h2>Gatilhos recentes</h2>
    ${d.recentTriggers.map((g) => `<div class="signal"><span class="chip">${esc(KIND_LABEL[g.subtype ?? ''] ?? g.subtype ?? 'gatilho')}</span>
      <a href="/empresa/${g.company_id}"><strong>${esc(g.company)}</strong></a>
      <div class="small"><a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${esc(g.title)}</a></div>
      <div class="small muted">${fmt(g.published_at)}</div></div>`).join('') || '<p class="muted small">Nenhum gatilho coletado ainda. Rode a atualização com notícias.</p>'}</div>
  <div class="card"><h2>Últimas atualizações</h2>
    ${d.runs.map((r) => `<div class="signal"><span class="${r.ok ? 'run-ok' : 'run-bad'}">${r.ok ? '✔' : '✖'}</span> <strong>${esc(r.collector)}</strong>
      <span class="small muted">${fmt(r.started_at)}</span><div class="small muted">${esc(r.summary)}</div></div>`).join('') || '<p class="muted small">Nenhuma atualização registrada.</p>'}
    ${isStatic ? '' : '<p class="small"><a href="/atualizar">Atualizar agora →</a></p>'}</div>
</div>
<p class="small muted">Dados de ${fmt(d.generatedAt)}${isStatic ? ' · versão publicada, somente leitura' : ''}.</p>`, isStatic);
}

export function updatePage(state: UpdateState, newsLimit: number): string {
  const steps: StepId[] = ['vagas', 'noticias', 'tecnologia', 'site', 'publicar'];
  const checked: Record<StepId, boolean> = { vagas: true, noticias: true, tecnologia: true, site: true, publicar: false };
  return layout('Atualizar · Radar', `
<div class="card">
  <h2>Atualizar o radar</h2>
  <p class="small muted">Busca vagas (Brasil e América Latina, sem consultorias), procura gatilhos nas notícias, recalcula as notas e regera o painel publicável.
    As notícias levam alguns minutos (1 consulta a cada 5 s, limite da fonte).</p>
  <form id="f" class="stack">
    <div class="steps">${steps.map((s) => `<label><input type="checkbox" name="step" value="${s}"${checked[s] ? ' checked' : ''}>${esc(STEP_LABEL[s])}${s === 'noticias' ? ` (${newsLimit} leads)` : ''}</label>`).join('')}</div>
    <p class="small muted" id="pubnote">“Publicar na Vercel” envia o painel para a internet (protegido por senha). Deixe desmarcado para só atualizar localmente.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button type="submit" id="go">Atualizar agora</button>
      <button type="button" class="btn secondary preset" data-steps="vagas,site">Só vagas e dor</button>
      <button type="button" class="btn secondary preset" data-steps="noticias,site">Só liderança e gatilhos</button>
      <button type="button" class="btn secondary preset" data-steps="tecnologia,site">Só tecnologia</button>
    </div>
    <span id="status" class="small muted"></span>
  </form>
</div>
<div class="card"><h2>Andamento</h2><pre class="log" id="log" aria-live="polite">${esc(state.log.join('\n')) || 'Nada em execução.'}</pre></div>
<script>
(function(){
  var f=document.getElementById('f'),go=document.getElementById('go'),logEl=document.getElementById('log'),st=document.getElementById('status');
  function render(s){
    go.disabled=s.running;
    st.textContent=s.running?('Executando: '+(s.stepLabel||'...')):(s.finishedAt?('Concluído em '+new Date(s.finishedAt).toLocaleTimeString('pt-BR')+(s.results.some(function(r){return !r.ok})?' (com falhas)':'')):'');
    if(s.log.length){logEl.textContent=s.log.join('\\n');logEl.scrollTop=logEl.scrollHeight;}
  }
  function poll(){fetch('/atualizar/status').then(function(r){return r.json()}).then(function(s){render(s);setTimeout(poll,s.running?1500:5000)}).catch(function(){setTimeout(poll,5000)});}
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var body=new URLSearchParams();new FormData(f).getAll('step').forEach(function(v){body.append('step',v)});
    if(!body.has('step'))return;
    fetch('/atualizar/executar',{method:'POST',body:body}).then(function(){poll()});
  });
  document.querySelectorAll('.preset').forEach(function(b){b.addEventListener('click',function(){
    var want=b.dataset.steps.split(',');
    f.querySelectorAll('input[name=step]').forEach(function(i){i.checked=want.indexOf(i.value)>=0;});
    f.requestSubmit();
  });});
  poll();
})();
</script>`);
}

export function modalityPage(
  info: ModalityInfo, rows: ModalityRow[], lastRun: { finished_at: string | null; error: string | null } | null, isStatic = false,
): string {
  const body = rows.length
    ? rows.map((r) => `<tr data-nota="${r.total ?? 0}" data-name="${esc(r.company.toLowerCase())}"${info.facets.map((f) => ` data-f-${f.key}="${esc((r.facets[f.key] ?? []).join('|'))}"`).join('')}>
  <td><span class="score ${scoreClass(r.total)}">${r.total ?? '—'}</span></td>
  <td><a href="/empresa/${r.companyId}"><strong>${esc(r.company)}</strong></a>
      ${r.reviewFlag ? `<span class="chip flag">revisar</span>` : ''}</td>
  <td>${extLink(r.url, `<strong>${esc(r.title)}</strong>`)}
      ${r.detail ? `<div class="evidence">${esc(r.detail)}</div>` : ''}</td>
  <td>${r.tags.map((t) => `<span class="chip">${esc(SUBTYPE_LABEL[t] ?? t)}</span>`).join('')}</td>
  <td class="small">${fmtDate(r.date)}</td>
  <td class="small">${esc(r.source)}</td>
</tr>`).join('')
    : `<tr><td colspan="6" class="muted">${esc(info.empty)}</td></tr>`;
  const status = lastRun
    ? lastRun.error ? `última coleta falhou: ${esc(lastRun.error.slice(0, 80))}` : `última coleta: ${fmtDate(lastRun.finished_at)}`
    : 'ainda não coletada';
  return layout(`${info.title} · Radar`, `
${leadTabs(info.id)}
<div class="card">
  <h2 style="font-size:18px">${esc(info.title)}</h2>
  <p class="small muted" style="margin:0 0 12px">${esc(info.description)}</p>
  <form class="filters" method="get" onsubmit="return false" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
    <label class="small muted">Buscar empresa<br><input name="q" placeholder="nome"></label>
    ${facetSelects(info, rows)}
    <label class="small muted">Nota mínima<br><input name="min" type="number" min="0" max="100" style="width:90px"></label>
    ${isStatic ? '' : `<a class="btn secondary" href="/atualizar">Atualizar ${esc(info.label.toLowerCase())}</a>`}
  </form>
</div>
<div class="card">
  <div class="muted small" style="margin-bottom:8px"><span id="count">${rows.length}</span> item(ns) · ${status}</div>
  <div class="table-wrap"><table>
    <thead><tr><th>Nota</th><th>Lead</th><th>O que foi encontrado</th><th>Detalhes</th><th>Data</th><th>Fonte</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>
</div>${MODALITY_FILTER_SCRIPT}`, isStatic);
}

// Um seletor por filtro da aba, com os valores que aparecem nos itens (e quantos itens têm cada um).
function facetSelects(info: ModalityInfo, rows: ModalityRow[]): string {
  return info.facets.map((f) => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const v of r.facets[f.key] ?? []) counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!counts.size) return '';
    const opts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([v, n]) => `<option value="${esc(v)}">${esc(v)} (${n})</option>`).join('');
    return `<label class="small muted">${esc(f.label)}<br><select data-facet="${esc(f.key)}"><option value="">Todos</option>${opts}</select></label>`;
  }).join('');
}

// Filtro no navegador (painel local e site publicado): busca, nota mínima e os filtros da aba.
const MODALITY_FILTER_SCRIPT = `<script>
(function () {
  var f = document.querySelector('form.filters');
  function apply() {
    var q = (f.q.value || '').toLowerCase(), min = +f.min.value || 0, n = 0;
    var facets = Array.prototype.slice.call(f.querySelectorAll('select[data-facet]')).filter(function (s) { return s.value; });
    document.querySelectorAll('tbody tr[data-nota]').forEach(function (tr) {
      var ok = tr.dataset.name.indexOf(q) >= 0 && +tr.dataset.nota >= min && facets.every(function (s) {
        return (tr.getAttribute('data-f-' + s.dataset.facet) || '').split('|').indexOf(s.value) >= 0;
      });
      tr.hidden = !ok; if (ok) n++;
    });
    document.getElementById('count').textContent = n;
  }
  f.addEventListener('input', apply); f.addEventListener('change', apply); apply();
})();
</script>`;
