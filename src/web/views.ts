// HTML do painel, renderizado no servidor (sem build de frontend).
import type { CompanyRow, Filters, SignalRow } from './queries.ts';
import { STATUSES, STAGES } from './queries.ts';
import type { BreakdownItem, OfferSuggestion } from '../scoring/score.ts';
import { DISCARD_REASONS, DISCARD_LABEL } from '../pipeline/decisions.ts';
import { MANUAL_ORIGINS } from '../pipeline/manualLeads.ts';
import { VISAO_LABEL, visoesOf, type Visao } from './queries.ts';

// Abas da seção Leads: a lista completa e as modalidades (ver modalities.ts).
const LEAD_TABS: [string, string, string][] = [
  ['todos', 'Todos', '/'], ['vagas', 'Vagas', '/radar/vagas'], ['lideranca', 'Liderança', '/radar/lideranca'],
  ['gatilhos', 'Outros gatilhos', '/radar/gatilhos'],
  ['concorrente', 'CRM concorrente', '/radar/concorrente'], ['tecnologia', 'Tecnologia', '/radar/tecnologia'],
];

// `counts`: quantos leads há em cada aba; aba vazia não aparece (a não ser a que está aberta).
export function leadTabs(active: string, counts?: Record<string, number>): string {
  const tabs = LEAD_TABS.filter(([id]) => id === 'todos' || id === active || !counts || (counts[id] ?? 0) > 0);
  return `<nav class="lead-tabs" aria-label="Seções de leads">${tabs.map(([id, label, href]) =>
    `<a class="btn${id === active ? '' : ' secondary'}" href="${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

// Link externo só quando há endereço (lead cadastrado à mão pode não ter).
export const extLink = (url: string | null, inner: string): string =>
  url && /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;

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
export const ROLE_LABEL: Record<string, string> = {
  arquiteto: 'Arquiteto', tech_lead: 'Tech Lead', developer: 'Developer', admin: 'Admin', funcional: 'Funcional/Consultor',
  qa: 'QA', usuario_crm: 'Usuário de CRM', outro: 'Outro',
  lideranca: 'Troca de liderança', fusao: 'Fusão/aquisição', investimento: 'Investimento', expansao: 'Expansão',
};

export const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('pt-BR');
};

export function layout(title: string, body: string, isStatic = false): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#0b5cad">
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
.chip.pain { background: transparent; border: 1px solid var(--bad); color: var(--bad); font-weight: 600; }
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
header nav { display: flex; gap: 14px; } header nav a { font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.kpi .n { font-size: 28px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; } .kpi .l { color: var(--muted); font-size: 12px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.bar-row { display: grid; grid-template-columns: 120px 1fr 36px; gap: 8px; align-items: center; margin: 5px 0; font-size: 13px; }
.bar-track { background: var(--chip); border-radius: 4px; height: 12px; overflow: hidden; } .bar-fill { background: var(--accent); height: 100%; min-width: 2px; }
.bar-val { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
.run-ok { color: var(--good); font-weight: 700; } .run-bad { color: var(--bad); font-weight: 700; }
pre.log { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px; max-height: 360px; overflow: auto; font-size: 12px; white-space: pre-wrap; margin: 0; }
.steps { display: flex; flex-wrap: wrap; gap: 14px; margin: 10px 0; } .steps label { display: flex; gap: 6px; align-items: center; }
button:disabled { opacity: .5; cursor: not-allowed; }
.lead-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.lead-tabs .btn { padding: 8px 16px; border-radius: 8px; }
.btn.ok, button.ok { background: var(--good); } .btn.bad, button.bad { background: var(--bad); }
.btn.sm, button.sm { padding: 3px 9px; font-size: 12px; }
.actions { display: flex; gap: 4px; flex-wrap: wrap; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tabs a { padding: 5px 12px; border-radius: 999px; background: var(--chip); color: var(--text); font-size: 13px; }
.tabs a.on { background: var(--accent); color: #fff; } .tabs a .c { opacity: .75; margin-left: 4px; }
.delta-up { color: var(--good); font-size: 12px; font-weight: 700; } .delta-down { color: var(--bad); font-size: 12px; font-weight: 700; }
.chip.out-reuniao, .chip.out-respondeu { background: var(--good); color: #fff; } .chip.out-contatado { background: var(--accent-weak); color: var(--accent); }
.chip.new { background: var(--accent-weak); color: var(--accent); }
.chip.st-qualificado, .chip.st-em_abordagem { background: transparent; border: 1px solid var(--good); color: var(--good); }
.chip.st-descartado { background: transparent; border: 1px solid var(--muted); color: var(--muted); }
.decision { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
.timeline .ev { padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
dialog { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); padding: 18px; width: min(440px, calc(100vw - 32px)); }
dialog::backdrop { background: rgb(0 0 0 / .35); }
dialog label { display: block; font-size: 12px; color: var(--muted); } dialog select, dialog textarea, dialog input { width: 100%; margin-top: 4px; }
#toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(20px); background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: 8px; opacity: 0; pointer-events: none; transition: .2s; z-index: 10; }
#toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
tr.leaving { opacity: 0; transition: opacity .25s; }
kbd { border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font-size: 11px; background: var(--bg); }
</style>
</head>
<body>
<header><h1><a href="/dashboard">Radar de Oportunidades Salesforce</a></h1>
  <nav><a href="/hoje">Hoje</a><a href="/dashboard">Dashboard</a>${isStatic ? '' : '<a href="/triagem">Triagem</a>'}<a href="/">Leads</a>${isStatic ? '' : '<a href="/atualizar">Atualizar</a>'}</nav>
  <span class="sub">Sottelli · uso interno · nada é enviado automaticamente</span></header>
<main>${body}</main>
${isStatic ? '' : DECISION_UI}
</body>
</html>`;
}

export const scoreClass = (n: number | null) => (n === null ? 'lo' : n >= 50 ? 'hi' : n >= 30 ? 'mid' : 'lo');

function option(value: string, label: string, current?: string) {
  return `<option value="${esc(value)}"${current === value ? ' selected' : ''}>${esc(label)}</option>`;
}

// `isStatic` = versão publicada (Vercel): filtros rodam no navegador e não há edição.
export function listPage(
  rows: CompanyRow[], f: Filters, runs: { collector: string; finished_at: string | null; stats: string | null }[],
  isStatic = false, counts?: Record<Visao, number>, tabs?: Record<string, number>,
): string {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const lastRun = runs[0];
  const visao = (f.visao && VISAO_LABEL.some(([v]) => v === f.visao) ? f.visao : 'padrao') as Visao;
  const linkFor = (v: Visao) => {
    const p = new URLSearchParams(Object.entries({ ...f, visao: v === 'padrao' ? '' : v }).filter(([, x]) => x) as [string, string][]).toString();
    return '/' + (p ? '?' + p : '');
  };
  // Situação: abas no painel local; no site publicado vira um seletor do filtro (roda no navegador).
  const situacao = isStatic ? '' : `<div class="tabs" aria-label="Situação">${VISAO_LABEL.map(([v, label]) =>
    `<a class="${v === visao ? 'on' : ''}" href="${linkFor(v)}">${esc(label)}${counts ? `<span class="c">${counts[v]}</span>` : ''}</a>`).join('')}</div>`;
  const filters = `
<form class="card filters" method="get" action="/"${isStatic ? ' onsubmit="return false"' : ''}>
  ${isStatic
    ? `<label>Situação<select name="visao">${VISAO_LABEL.map(([v, label]) => option(v === 'padrao' ? '' : v, label, '')).join('')}</select></label>`
    : (visao !== 'padrao' ? `<input type="hidden" name="visao" value="${esc(visao)}">` : '')}
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
        const attrs = ` data-id="${r.id}" data-nota="${r.total ?? 0}" data-name="${esc(r.name.toLowerCase())}" data-setor="${esc(r.sector ?? '')}" data-oferta="${esc(offers.map((o) => o.offer).join(','))}" data-sinal="${esc(r.signal_types ?? '')}" data-status="${esc(r.status)}" data-visao="${visoesOf(r).join(',')}"${r.excluded_reason ? ' data-excl="1"' : ''}`;
        const delta = r.prev_total !== null && r.total !== null && r.prev_total !== r.total
          ? (r.total > r.prev_total
            ? `<div class="delta-up" title="Nota anterior: ${r.prev_total}">▲ +${r.total - r.prev_total}</div>`
            : `<div class="delta-down" title="Nota anterior: ${r.prev_total}">▼ ${r.total - r.prev_total}</div>`)
          : '';
        return `<tr${attrs}>
  <td><span class="score ${scoreClass(r.total)}">${r.total ?? '—'}</span>${delta}</td>
  <td><a href="/empresa/${r.id}"><strong>${esc(r.name)}</strong></a>
      ${r.new_signals ? `<span class="chip new" title="Sinal novo nos últimos 7 dias">novo</span>` : ''}
      ${r.excluded_reason ? `<span class="chip flag">excluída: ${esc(r.excluded_reason)}</span>` : ''}
      ${r.review_count ? `<span class="chip flag">revisar</span>` : ''}
      ${bd.some((b) => b.group === 'dor' && b.points > 0) ? `<span class="chip pain" title="Há indício de insatisfação com o sistema atual">dor</span>` : ''}
      <div class="small muted">${top.map((b) => `+${b.points} ${esc(b.rule)}`).join(' · ')}</div></td>
  <td>${offers.map((o) => `<span class="chip offer">${esc(o.offer)}</span>`).join('') || '<span class="muted">—</span>'}</td>
  <td>${r.sector ? esc(SECTOR_LABEL[r.sector] ?? r.sector) + (r.sector_source?.startsWith('inferido') ? ' <span class="muted small">(inferido)</span>' : '') : '<span class="muted">—</span>'}</td>
  <td>${esc([r.city, r.state].filter(Boolean).join(' / ')) || '<span class="muted">—</span>'}</td>
  <td>${(r.signal_types ?? '').split(',').filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}<span class="small muted">${r.job_count} vaga(s)</span></td>
  <td class="small">${fmtDate(r.last_signal_at)}</td>
  <td class="small">${statusChip(r)}</td>
  ${isStatic ? '' : `<td><div class="actions">${decisionButtons(r.id, r.status, true, r.outreach)}</div></td>`}
</tr>`;
      }).join('')
    : `<tr><td colspan="${isStatic ? 8 : 9}" class="muted">${visao === 'triagem' ? 'Nada para triar agora.' : 'Nenhum lead com esses filtros.'} Use “Atualizar” para buscar novos sinais.</td></tr>`;

  const addLead = isStatic ? '' : `
<div style="display:flex;justify-content:flex-end;margin:-6px 0 10px"><button type="button" onclick="document.getElementById('dlg-novo').showModal()">+ Adicionar lead</button></div>
<dialog id="dlg-novo"><form method="post" action="/leads/novo" class="stack">
  <h2>Adicionar lead</h2>
  <p class="small muted" style="margin:0">Para indicação, ex-cliente, empresa vista em evento ou contato próprio. Entra com +15 na nota.</p>
  <label>Empresa<input name="name" required minlength="2"></label>
  <label>Origem<select name="origin">${MANUAL_ORIGINS.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>
  <label>Detalhe (quem indicou, qual evento...)<input name="detail"></label>
  <label>Site (opcional, ativa a detecção de tecnologia)<input name="domain" placeholder="empresa.com.br"></label>
  <div class="actions"><button type="submit">Adicionar</button><button type="button" class="btn secondary" onclick="this.closest('dialog').close()">Cancelar</button></div>
</form></dialog>`;
  return layout('Leads · Radar', `
${leadTabs('todos', tabs)}
${addLead}
${situacao}
${filters}
<div class="card">
  <div class="muted small" style="margin-bottom:8px"><span id="count">${rows.length}</span> lead(s) · ordenados por nota
    ${lastRun ? ` · última coleta: ${esc(lastRun.collector)} em ${fmtDate(lastRun.finished_at)}` : ''}</div>
  <div class="table-wrap"><table data-visao-page="${esc(visao)}">
    <thead><tr><th>Nota</th><th>Lead</th><th>Oferta sugerida</th><th>Setor</th><th>Local</th><th>Sinais</th><th>Último sinal</th><th>Situação</th>${isStatic ? '' : '<th>Decidir</th>'}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>
</div>${isStatic ? STATIC_FILTER_SCRIPT : LIST_DECISION_SCRIPT}`, isStatic);
}

// Na lista: depois de decidir, a linha sai se não pertence mais à aba atual; senão a página recarrega.
const LIST_DECISION_SCRIPT = `<script>
document.addEventListener('radar:decided', function (e) {
  var tr = document.querySelector('tr[data-id="' + e.detail.id + '"]');
  if (!tr) return;
  var page = document.querySelector('table[data-visao-page]').dataset.visaoPage;
  if ((e.detail.result.visoes || []).indexOf(page) < 0) {
    tr.classList.add('leaving');
    setTimeout(function () {
      tr.remove();
      var c = document.getElementById('count'); c.textContent = Math.max(0, +c.textContent - 1);
    }, 260);
  } else {
    setTimeout(function () { location.reload(); }, 500);
  }
});
</script>`;

export function detailPage(d: {
  company: CompanyRow & { notes: string | null; next_action: string | null; next_action_at: string | null; rules_version: string | null; domain: string | null; cnpj: string | null };
  signals: SignalRow[];
  aliases: { alias: string; source: string }[];
  breakdown: BreakdownItem[];
  offers: OfferSuggestion[];
  events?: { kind: string; detail: string | null; created_at: string }[];
  contacts?: { id: number; name: string; role: string | null; since: string | null; channel: string | null; origin: string }[];
}, isStatic = false): string {
  const c = d.company;
  const EVENT_LABEL: Record<string, string> = {
    aprovada: 'Aprovada', descartada: 'Descartada', adiada: 'Adiada', reaberta: 'Reaberta', etapa: 'Etapa do funil',
    cadastrada: 'Cadastrada à mão', juncao: 'Duplicado juntado', contato: 'Abordagem',
  };
  const timeline = (d.events ?? []).map((e) => `<div class="ev"><strong>${esc(EVENT_LABEL[e.kind] ?? e.kind)}</strong>
    ${e.detail ? ` · ${esc(e.detail)}` : ''}<div class="small muted">${fmtDate(e.created_at)}</div></div>`).join('')
    || '<p class="small muted">Nenhuma decisão registrada ainda.</p>';
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
  <div>${extLink(s.url, `<strong>${esc(s.title)}</strong>`)}</div>
  ${s.evidence ? `<div class="evidence">${esc(s.evidence)}</div>` : ''}
  <div class="small muted">Fonte: ${esc(s.source)} · publicada em ${fmtDate(s.published_at)} · coletada em ${fmtDate(s.collected_at)} · vista por último em ${fmtDate(s.last_seen_at)}</div>
</div>`;
  }).join('') || '<p class="muted">Sem sinais.</p>';

  return layout(`${c.name} · Radar`, `
<p class="small"><a href="/">← voltar para os leads</a></p>
<div class="grid">
  <div class="stack">
    <div class="card">
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div><div class="big score ${scoreClass(c.total)}">${c.total ?? '—'}</div><div class="small muted">nota (${esc(c.rules_version ?? '')})</div></div>
        <div><h2 style="margin:0;font-size:20px">${esc(c.name)}</h2>
          <div class="small muted">Aderência ${c.fit ?? 0}/40 · Sinal ${c.signal ?? 0}/60 · calculada em ${fmtDate(c.computed_at)}</div>
          <div class="small muted">${esc([c.city, c.state].filter(Boolean).join(' / '))}${c.sector ? ' · ' + esc(SECTOR_LABEL[c.sector] ?? c.sector) + ' (' + esc(c.sector_source) + ')' : ''}</div>
          ${c.excluded_reason ? `<span class="chip flag">excluída: ${esc(c.excluded_reason)}</span>` : ''}
          <div style="margin-top:6px">${statusChip(c)}</div></div>
      </div>
      ${isStatic ? '' : `<div class="decision">${decisionButtons(c.id, c.status, false, c.outreach)}</div>`}
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
      <label class="small muted">Próxima ação<br><input name="next_action" value="${esc(c.next_action)}" style="width:100%"></label>
      <label class="small muted">Data da próxima ação<br><input type="date" name="next_action_at" value="${esc(c.next_action_at)}"></label>
      <label class="small muted">Excluir do radar<br><select name="excluded_reason">${option('', 'Não excluir', c.excluded_reason ?? '')}${option('cliente', 'Já é cliente', c.excluded_reason ?? '')}${option('concorrente', 'Concorrente/consultoria', c.excluded_reason ?? '')}${option('recrutadora', 'Recrutadora', c.excluded_reason ?? '')}</select></label>
      <label class="small muted">Anotações<br><textarea name="notes" rows="4" style="width:100%">${esc(c.notes)}</textarea></label>
      <button type="submit">Salvar</button>
    </form>`}
    <div class="card"><h2>Contatos</h2>
      ${(d.contacts ?? []).map((p) => `<div class="ev small"><strong>${esc(p.name)}</strong>${p.role ? ` — ${esc(p.role)}` : ''}${p.since ? ` <span class="muted">(desde ${esc(p.since.split('-').reverse().join('/'))})</span>` : ''}
        ${p.channel ? `<div>${/^https?:/.test(p.channel) ? extLink(p.channel, esc(p.channel)) : esc(p.channel)}</div>` : ''}<div class="muted">${esc(p.origin === 'manual' ? 'cadastrado à mão' : p.origin)}</div></div>`).join('') || '<p class="small muted">Nenhum contato ainda.</p>'}
      ${isStatic ? '' : `<form method="post" action="/empresa/${c.id}/contato" class="stack" style="margin-top:10px">
        <input name="name" placeholder="Nome" required style="width:100%">
        <input name="role" placeholder="Cargo" style="width:100%">
        <input name="channel" placeholder="E-mail, telefone ou link do perfil" style="width:100%">
        <button type="submit" class="btn secondary sm">Adicionar contato</button></form>`}
      <p class="small muted" style="margin:8px 0 0">Dados de contato para abordagem B2B (legítimo interesse). Se a pessoa pedir, remova.</p></div>
    <div class="card timeline"><h2>Histórico</h2>${timeline}</div>
    <div class="card small"><h2>Nomes encontrados</h2>${d.aliases.map((a) => `<div>${esc(a.alias)} <span class="muted">(${esc(a.source)})</span></div>`).join('')}</div>
  </div>
</div>${isStatic ? '' : `<script>document.addEventListener('radar:decided', function () { setTimeout(function () { location.reload(); }, 500); });</script>`}`, isStatic);
}

// Janelas de descartar/adiar, aviso de confirmação e o script comum das decisões (só no painel local).
// Qualquer elemento com data-decide="aprovar|descartar|adiar|reabrir" e data-id dispara a decisão;
// ao concluir, o documento recebe o evento "radar:decided" (a página decide o que atualizar).
const DECISION_UI = `
<dialog id="dlg-descartar"><form method="dialog" class="stack">
  <h2>Descartar lead</h2>
  <label>Motivo<select name="reason">${DISCARD_REASONS.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select></label>
  <p class="small muted" style="margin:0">"Já é cliente" e "Concorrente" também tiram a empresa das próximas coletas.</p>
  <label>Observação (opcional)<textarea name="note" rows="3"></textarea></label>
  <div class="actions"><button value="ok" class="bad">Descartar</button><button value="cancel" class="btn secondary" formnovalidate>Cancelar</button></div>
</form></dialog>
<dialog id="dlg-adiar"><form method="dialog" class="stack">
  <h2>Adiar lead</h2>
  <p class="small muted" style="margin:0">Some da triagem até a data e volta sozinha depois.</p>
  <label>Voltar a mostrar em<input type="date" name="until" required></label>
  <label>Observação (opcional)<textarea name="note" rows="2"></textarea></label>
  <div class="actions"><button value="ok">Adiar</button><button value="cancel" class="btn secondary" formnovalidate>Cancelar</button></div>
</form></dialog>
<div id="toast" role="status" aria-live="polite"></div>
<script>
window.radar = (function () {
  var MSG = { aprovar: 'Lead aprovado', descartar: 'Lead descartado', adiar: 'Lead adiado', reabrir: 'Lead reaberto',
    contatei: 'Contato registrado', respondeu: 'Resposta registrada', reuniao: 'Reunião registrada', sem_resposta: 'Registrado: sem resposta' };
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function ask(id) {
    return new Promise(function (resolve) {
      var d = document.getElementById(id), f = d.querySelector('form');
      f.reset();
      if (f.until) f.until.value = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      d.returnValue = '';
      d.showModal();
      d.addEventListener('close', function h() {
        d.removeEventListener('close', h);
        resolve(d.returnValue === 'ok' ? Object.fromEntries(new FormData(f)) : null);
      });
    });
  }
  function decide(id, action) {
    var extra = action === 'descartar' ? ask('dlg-descartar') : action === 'adiar' ? ask('dlg-adiar') : Promise.resolve({});
    return extra.then(function (data) {
      if (!data) return null;
      data.action = action;
      return fetch('/empresa/' + id + '/decisao', { method: 'POST', body: new URLSearchParams(data) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || 'falhou'); return j; }); })
        .then(function (j) {
          toast(MSG[action]);
          document.dispatchEvent(new CustomEvent('radar:decided', { detail: { id: String(id), action: action, result: j } }));
          return j;
        });
    }).catch(function (e) { toast('Não foi possível salvar: ' + e.message); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-decide]');
    if (!b) return;
    e.preventDefault();
    decide(b.dataset.id, b.dataset.decide);
  });
  return { decide: decide, toast: toast };
})();
</script>`;

// Botões de decisão conforme a situação atual da conta.
// Próximo passo conforme a situação: triar (aprovar/descartar/adiar) e, depois de aprovado,
// registrar a abordagem: Contatei → Respondeu ou Sem resposta → Reunião marcada.
export function decisionButtons(id: number, status: string, small = false, outreach: string | null = null): string {
  const sm = small ? ' sm' : '';
  const b = (action: string, label: string, cls: string, title: string) =>
    `<button type="button" class="${cls}${sm}" data-decide="${action}" data-id="${id}" title="${title}">${label}</button>`;
  if (status === 'descartado') return b('reabrir', 'Reabrir', 'btn secondary', 'Volta para a triagem');
  const approved = status === 'qualificado' || status === 'em_abordagem';
  const next = !approved
    ? [b('aprovar', 'Aprovar', 'ok', 'Vale abordar')]
    : outreach === 'contatado'
      ? [b('respondeu', 'Respondeu', 'ok', 'O contato respondeu'), b('sem_resposta', 'Sem resposta', 'btn secondary', 'Não respondeu')]
      : outreach === 'respondeu'
        ? [b('reuniao', 'Reunião marcada', 'ok', 'Reunião agendada'), b('sem_resposta', 'Esfriou', 'btn secondary', 'Parou de responder')]
        : outreach === 'reuniao'
          ? []
          : [b('contatei', outreach === 'sem_resposta' ? 'Contatei de novo' : 'Contatei', 'ok', 'Registrar que a abordagem foi feita')];
  return [...next, b('descartar', 'Descartar', 'bad', 'Não vale abordar (pede o motivo)'), approved && outreach ? '' : b('adiar', 'Adiar', 'btn secondary', 'Esconde até uma data')].join('');
}

const OUTREACH_LABEL: Record<string, string> = { contatado: 'Contatado', respondeu: 'Respondeu', reuniao: 'Reunião marcada', sem_resposta: 'Sem resposta' };

export function statusChip(r: { status: string; discard_reason: string | null; snoozed_until: string | null; outreach?: string | null }): string {
  const today = new Date().toISOString().slice(0, 10);
  const snoozed = r.snoozed_until && r.snoozed_until > today && r.status !== 'descartado';
  return `<span class="chip st-${esc(r.status)}">${esc(STATUS_LABEL[r.status] ?? r.status)}</span>`
    + (r.outreach ? `<span class="chip out-${esc(r.outreach)}">${esc(OUTREACH_LABEL[r.outreach] ?? r.outreach)}</span>` : '')
    + (r.status === 'descartado' && r.discard_reason ? `<div class="small muted">${esc(DISCARD_LABEL[r.discard_reason] ?? r.discard_reason)}</div>` : '')
    + (snoozed ? `<div class="small muted">adiada até ${esc(r.snoozed_until!.split('-').reverse().join('/'))}</div>` : '');
}

export function notFoundPage(): string {
  return layout('Não encontrado', '<div class="card">Lead não encontrado. <a href="/">Voltar</a></div>');
}

export const STATIC_FILTER_SCRIPT = `<script>
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
        &&(v.excluidas==='1'||!d.excl)
        &&(!d.visao||d.visao.split(',').indexOf(v.visao||'padrao')>=0);
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
