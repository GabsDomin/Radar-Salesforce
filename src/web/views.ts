// HTML do painel, renderizado no servidor (sem build de frontend).
import type { CompanyRow, Filters, SignalRow } from './queries.ts';
import { STATUSES, STAGES } from './queries.ts';
import type { BreakdownItem, OfferSuggestion } from '../scoring/score.ts';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SECTOR_LABEL: Record<string, string> = { industria: 'Indústria', financeiro: 'Serv. financeiros', agro: 'Agronegócio' };
const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', em_analise: 'Em análise', qualificado: 'Qualificado', em_abordagem: 'Em abordagem', descartado: 'Descartado',
};
const STAGE_LABEL: Record<string, string> = {
  radar: 'Radar', aprovada: 'Aprovada', abordagem: 'Em abordagem', respondeu: 'Respondeu', reuniao: 'Reunião',
  proposta: 'Proposta', ganha: 'Ganha', perdida: 'Perdida',
};
const ROLE_LABEL: Record<string, string> = {
  arquiteto: 'Arquiteto', tech_lead: 'Tech Lead', developer: 'Developer', admin: 'Admin', funcional: 'Funcional/Consultor',
  qa: 'QA', usuario_crm: 'Usuário de CRM', outro: 'Outro',
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('pt-BR');
};

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root {
  --bg: #f6f7f9; --surface: #ffffff; --text: #1b1f24; --muted: #5d6673; --border: #dde1e6;
  --accent: #0b5cad; --accent-weak: #e6f0fa; --good: #1d7a46; --warn: #a15c00; --bad: #b42318;
  --chip: #eef1f4;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111418; --surface: #1a1e24; --text: #e7eaee; --muted: #9aa4b1; --border: #2c323a;
    --accent: #6aa9f0; --accent-weak: #1c2a3a; --good: #5cc28a; --warn: #e0a24a; --bad: #f07a6e; --chip: #252b33; }
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
header h1 { font-size: 17px; margin: 0; } header .sub { color: var(--muted); font-size: 13px; }
main { max-width: 1280px; margin: 0 auto; padding: 20px 16px 48px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
form.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
form.filters label { display: flex; flex-direction: column; font-size: 12px; color: var(--muted); gap: 4px; }
input, select, textarea { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
button, .btn { font: inherit; background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer; display: inline-block; }
.btn.secondary { background: var(--chip); color: var(--text); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; white-space: nowrap; }
.score { font-weight: 700; font-size: 16px; font-variant-numeric: tabular-nums; }
.score.hi { color: var(--good); } .score.mid { color: var(--warn); } .score.lo { color: var(--muted); }
.chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 1px 9px; font-size: 12px; margin: 0 4px 4px 0; white-space: nowrap; }
.chip.offer { background: var(--accent-weak); color: var(--accent); font-weight: 600; }
.chip.flag { background: transparent; border: 1px solid var(--warn); color: var(--warn); }
.muted { color: var(--muted); } .small { font-size: 12px; }
.grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.bd-row { display: grid; grid-template-columns: 60px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.bd-pts { font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-pts.neg { color: var(--bad); }
.signal { padding: 10px 0; border-bottom: 1px solid var(--border); }
.evidence { background: var(--bg); border-left: 3px solid var(--border); padding: 6px 10px; margin: 6px 0; font-size: 13px; color: var(--muted); }
h2 { font-size: 15px; margin: 0 0 10px; }
.big { font-size: 34px; font-weight: 800; line-height: 1; }
.stack > * + * { margin-top: 10px; }
</style>
</head>
<body>
<header><h1><a href="/">Radar de Oportunidades Salesforce</a></h1><span class="sub">Sottelli · uso interno · nada é enviado automaticamente</span></header>
<main>${body}</main>
</body>
</html>`;
}

const scoreClass = (n: number | null) => (n === null ? 'lo' : n >= 50 ? 'hi' : n >= 30 ? 'mid' : 'lo');

function option(value: string, label: string, current?: string) {
  return `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(label)}</option>`;
}

// `isStatic` = versão publicada (Vercel): filtros rodam no navegador e não há edição.
export function listPage(rows: CompanyRow[], f: Filters, runs: { collector: string; finished_at: string | null; stats: string | null }[], isStatic = false): string {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const lastRun = runs[0];
  const filters = `
<form class="card filters" method="get" action="/"${isStatic ? ' onsubmit="return false"' : ''}>
  <label>Buscar<input name="q" value="${esc(f.q)}" placeholder="nome da empresa"></label>
  <label>Setor<select name="setor">${option('', 'Todos', f.setor)}${option('industria', 'Indústria', f.setor)}${option('financeiro', 'Serv. financeiros', f.setor)}${option('agro', 'Agronegócio', f.setor)}${option('desconhecido', 'Não identificado', f.setor)}</select></label>
  <label>Oferta<select name="oferta">${option('', 'Todas', f.oferta)}${option('Keep', 'Keep (sustentação)', f.oferta)}${option('Improve', 'Improve (alocação)', f.oferta)}${option('Ágil', 'Ágil (projeto)', f.oferta)}</select></label>
  <label>Sinal<select name="sinal">${option('', 'Todos', f.sinal)}${option('vaga', 'Vaga', f.sinal)}${option('tecnologia', 'Tecnologia', f.sinal)}${option('gatilho', 'Gatilho', f.sinal)}</select></label>
  <label>Status<select name="status">${option('', 'Todos', f.status)}${STATUSES.map((s) => option(s, STATUS_LABEL[s], f.status)).join('')}</select></label>
  <label>Nota mínima<input name="min" type="number" min="0" max="100" value="${esc(f.min)}" style="width:90px"></label>
  <label><span>Excluídas</span><select name="excluidas">${option('', 'Ocultar', f.excluidas)}${option('1', 'Mostrar', f.excluidas)}</select></label>
  <button type="submit">Filtrar</button>
  ${isStatic ? '<a class="btn secondary" href="/radar.csv" download>Exportar CSV</a>' : `<a class="btn secondary" href="/export.csv${qs ? '?' + qs : ''}">Exportar CSV</a>`}
</form>`;

  const body = rows.length
    ? rows.map((r) => {
        const offers: OfferSuggestion[] = r.offers ? JSON.parse(r.offers) : [];
        const bd: BreakdownItem[] = r.breakdown ? JSON.parse(r.breakdown) : [];
        const top = bd.filter((b) => b.points > 0).sort((a, b) => b.points - a.points).slice(0, 2);
        const attrs = ` data-nota="${r.total ?? 0}" data-name="${esc(r.name.toLowerCase())}" data-setor="${esc(r.sector ?? '')}" data-oferta="${esc(offers.map((o) => o.offer).join(','))}" data-sinal="${esc(r.signal_types ?? '')}" data-status="${esc(r.status)}"${r.excluded_reason ? ' data-excl="1"' : ''}`;
        return `<tr${attrs}>
  <td><span class="score ${scoreClass(r.total)}">${r.total ?? '—'}</span></td>
  <td><a href="/empresa/${r.id}"><strong>${esc(r.name)}</strong></a>
      ${r.excluded_reason ? `<span class="chip flag">excluída: ${esc(r.excluded_reason)}</span>` : ''}
      ${r.review_count ? `<span class="chip flag">revisar</span>` : ''}
      <div class="small muted">${top.map((b) => `+${b.points} ${esc(b.rule)}`).join(' · ')}</div></td>
  <td>${offers.map((o) => `<span class="chip offer">${esc(o.offer)}</span>`).join('') || '<span class="muted">—</span>'}</td>
  <td>${r.sector ? esc(SECTOR_LABEL[r.sector] ?? r.sector) + (r.sector_source?.startsWith('inferido') ? ' <span class="muted small">(inferido)</span>' : '') : '<span class="muted">—</span>'}</td>
  <td>${esc([r.city, r.state].filter(Boolean).join(' / ')) || '<span class="muted">—</span>'}</td>
  <td>${(r.signal_types ?? '').split(',').filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}<span class="small muted">${r.job_count} vaga(s)</span></td>
  <td class="small">${fmtDate(r.last_signal_at)}</td>
  <td class="small">${esc(STATUS_LABEL[r.status] ?? r.status)}</td>
</tr>`;
      }).join('')
    : `<tr><td colspan="8" class="muted">Nenhuma conta com esses filtros. Rode <code>npm run coletar</code> para buscar vagas.</td></tr>`;

  return layout('Radar Salesforce', `
${filters}
<div class="card">
  <div class="muted small" style="margin-bottom:8px"><span id="count">${rows.length}</span> conta(s) · ordenadas por nota
    ${lastRun ? ` · última coleta: ${esc(lastRun.collector)} em ${fmtDate(lastRun.finished_at)}` : ''}</div>
  <div class="table-wrap"><table>
    <thead><tr><th>Nota</th><th>Empresa</th><th>Oferta sugerida</th><th>Setor</th><th>Local</th><th>Sinais</th><th>Último sinal</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>
</div>${isStatic ? STATIC_FILTER_SCRIPT : ''}`);
}

export function detailPage(d: {
  company: CompanyRow & { notes: string | null; next_action: string | null; next_action_at: string | null; rules_version: string | null; domain: string | null; cnpj: string | null };
  signals: SignalRow[];
  aliases: { alias: string; source: string }[];
  breakdown: BreakdownItem[];
  offers: OfferSuggestion[];
}, isStatic = false): string {
  const c = d.company;
  const bd = d.breakdown.map((b) => `
<div class="bd-row">
  <div class="bd-pts${b.points < 0 ? ' neg' : ''}">${b.points > 0 ? '+' : ''}${b.points}${b.max ? `<span class="muted small">/${b.max}</span>` : ''}</div>
  <div><strong>${esc(b.rule)}</strong><div class="small">${esc(b.reason)}</div>
    ${b.signalIds.length ? `<div class="small muted">evidências: ${b.signalIds.map((id) => `<a href="#sinal-${id}">#${id}</a>`).join(', ')}</div>` : ''}</div>
</div>`).join('');

  const offers = d.offers.length
    ? d.offers.map((o) => `<div><span class="chip offer">${esc(o.offer)}</span><ul class="small">${o.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`).join('')
    : '<p class="muted small">Sem sinal suficiente para sugerir oferta.</p>';

  const signals = d.signals.map((s) => {
    const meta = s.meta ? JSON.parse(s.meta) : {};
    return `
<div class="signal" id="sinal-${s.id}">
  <div><span class="chip">#${s.id} ${esc(s.type)}</span>${s.subtype ? `<span class="chip">${esc(ROLE_LABEL[s.subtype] ?? s.subtype)}</span>` : ''}
    ${(meta.clouds ?? []).map((cl: string) => `<span class="chip">${esc(cl)}</span>`).join('')}
    ${s.review_flag ? `<span class="chip flag">${esc(s.review_flag)}</span>` : ''}</div>
  <div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(s.title)}</strong></a></div>
  ${s.evidence ? `<div class="evidence">${esc(s.evidence)}</div>` : ''}
  <div class="small muted">Fonte: ${esc(s.source)} · publicada em ${fmtDate(s.published_at)} · coletada em ${fmtDate(s.collected_at)} · vista por último em ${fmtDate(s.last_seen_at)}</div>
</div>`;
  }).join('') || '<p class="muted">Sem sinais.</p>';

  return layout(`${c.name} · Radar`, `
<p class="small"><a href="/">← voltar para a lista</a></p>
<div class="grid">
  <div class="stack">
    <div class="card">
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div><div class="big score ${scoreClass(c.total)}">${c.total ?? '—'}</div><div class="small muted">nota (${esc(c.rules_version ?? '')})</div></div>
        <div><h2 style="margin:0;font-size:20px">${esc(c.name)}</h2>
          <div class="small muted">Aderência ${c.fit ?? 0}/40 · Sinal ${c.signal ?? 0}/60 · calculada em ${fmtDate(c.computed_at)}</div>
          <div class="small muted">${esc([c.city, c.state].filter(Boolean).join(' / '))}${c.sector ? ' · ' + esc(SECTOR_LABEL[c.sector] ?? c.sector) + ' (' + esc(c.sector_source) + ')' : ''}</div>
          ${c.excluded_reason ? `<span class="chip flag">excluída: ${esc(c.excluded_reason)}</span>` : ''}</div>
      </div>
    </div>
    <div class="card"><h2>Por que essa nota</h2>${bd || '<p class="muted">Ainda não pontuada.</p>'}</div>
    <div class="card"><h2>Evidências (${d.signals.length})</h2>${signals}</div>
  </div>
  <div class="stack">
    <div class="card"><h2>Oferta sugerida</h2>${offers}</div>
    <div class="card"><h2>Hipótese e rascunho de abordagem</h2>
      <p class="small muted">Geração via Claude API entra na etapa 9. O rascunho nunca é enviado automaticamente.</p></div>
    ${isStatic ? readOnlyFollowUp(c) : `<form class="card stack" method="post" action="/empresa/${c.id}">
      <h2>Acompanhamento</h2>
      <label class="small muted">Status<br><select name="status">${STATUSES.map((s) => option(s, STATUS_LABEL[s], c.status)).join('')}</select></label>
      <label class="small muted">Etapa do funil<br><select name="stage">${STAGES.map((s) => option(s, STAGE_LABEL[s], c.stage)).join('')}</select></label>
      <label class="small muted">Próxima ação<br><input name="next_action" value="${esc(c.next_action)}" style="width:100%"></label>
      <label class="small muted">Data da próxima ação<br><input type="date" name="next_action_at" value="${esc(c.next_action_at)}"></label>
      <label class="small muted">Excluir do radar<br><select name="excluded_reason">${option('', 'Não excluir', c.excluded_reason ?? '')}${option('cliente', 'Já é cliente', c.excluded_reason ?? '')}${option('concorrente', 'Concorrente/consultoria', c.excluded_reason ?? '')}${option('recrutadora', 'Recrutadora', c.excluded_reason ?? '')}</select></label>
      <label class="small muted">Anotações<br><textarea name="notes" rows="4" style="width:100%">${esc(c.notes)}</textarea></label>
      <button type="submit">Salvar</button>
    </form>`}
    <div class="card small"><h2>Nomes encontrados</h2>${d.aliases.map((a) => `<div>${esc(a.alias)} <span class="muted">(${esc(a.source)})</span></div>`).join('')}</div>
  </div>
</div>`);
}

export function notFoundPage(): string {
  return layout('Não encontrado', '<div class="card">Conta não encontrada. <a href="/">Voltar</a></div>');
}

const STATIC_FILTER_SCRIPT = `<script>
(function(){
  var f=document.querySelector('form.filters');
  function apply(){
    var v=Object.fromEntries(new FormData(f)),n=0;
    document.querySelectorAll('tbody tr[data-nota]').forEach(function(tr){
      var d=tr.dataset;
      var ok=(!v.q||d.name.indexOf(v.q.toLowerCase())>=0)
        &&(!v.setor||(v.setor==='desconhecido'?!d.setor:d.setor===v.setor))
        &&(!v.oferta||d.oferta.split(',').indexOf(v.oferta)>=0)
        &&(!v.sinal||d.sinal.split(',').indexOf(v.sinal)>=0)
        &&(!v.status||d.status===v.status)
        &&(!v.min||+d.nota>=+v.min)
        &&(v.excluidas==='1'||!d.excl);
      tr.hidden=!ok; if(ok)n++;
    });
    document.getElementById('count').textContent=n;
  }
  f.addEventListener('input',apply);apply();
})();
</script>`;

function readOnlyFollowUp(c: { status: string; stage: string; next_action: string | null; next_action_at: string | null; notes: string | null }): string {
  return `<div class="card stack">
      <h2>Acompanhamento</h2>
      <p class="small muted">Versão publicada, somente leitura. Edite no painel local e publique de novo.</p>
      <div class="small">Status: <strong>${esc(STATUS_LABEL[c.status] ?? c.status)}</strong> · Etapa: <strong>${esc(STAGE_LABEL[c.stage] ?? c.stage)}</strong></div>
      <div class="small">Próxima ação: ${esc(c.next_action) || '—'}${c.next_action_at ? ' (' + esc(c.next_action_at) + ')' : ''}</div>
      ${c.notes ? `<div class="small" style="white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
    </div>`;
}
