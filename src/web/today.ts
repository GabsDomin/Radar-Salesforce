// Página "Hoje": quem abordar agora, separado pela oferta da Sottelli, com o motivo, com quem falar
// e um rascunho de mensagem. É o centro do trabalho comercial; as outras telas servem para explorar.
//   Improve  vaga Salesforce aberta (orçamento aprovado, dor imediata): a venda mais rápida
//   Ágil     CRM concorrente, migração, fusão, diretoria nova: projeto
//   Keep     já usa Salesforce (DNS, site, caso publicado): sustentação
import type { DB } from '../db/index.ts';
import { draftMessage, TARGET_ROLE, type Offer, type Draft } from '../outreach/draft.ts';
import { esc, layout, scoreClass, decisionButtons, statusChip, extLink } from './views.ts';
import { toCsv } from '../util/csv.ts';

const DAY = 86_400_000;
const STILL_OPEN_DAYS = 21;   // vaga vista nos últimos 21 dias = ainda aberta
const PER_OFFER = 12;
const FOLLOW_UP_DAYS = 5;     // sem retorno há 5+ dias: lembrar de cobrar

const IMPROVE_ROLES = ['developer', 'admin', 'funcional', 'qa', 'arquiteto', 'tech_lead'];
const EVERGREEN_TITLE = /banco de talentos|talent pool|cadastro reserva|vagas? futuras?|oportunidades futuras|cadastre seu curr/i;
const MAX_REAL_OPEN_DAYS = 180;

interface SignalRow {
  company_id: number; type: string; subtype: string | null; title: string; url: string; source: string;
  published_at: string | null; collected_at: string; last_seen_at: string; meta: string | null;
}
interface CompanyRow {
  id: number; name: string; status: string; discard_reason: string | null; snoozed_until: string | null;
  outreach: string | null; outreach_at: string | null; total: number | null; cnpj: string | null; sector: string | null; state: string | null;
}

export interface TodayItem {
  id: number; name: string; total: number | null; status: string; outreach: string | null;
  discard_reason: string | null; snoozed_until: string | null;
  offer: Offer; reason: string; evidenceUrl: string | null; priority: number;
  contacts: { name: string; role: string | null; since: string | null; origin: string }[];
  draft: Draft;
}

export interface FollowUp { id: number; name: string; outreach: string; days: number; late: boolean; status: string; discard_reason: string | null; snoozed_until: string | null }

export interface TodayData { improve: TodayItem[]; agil: TodayItem[]; keep: TodayItem[]; followUps: FollowUp[]; installedBase: number }

const meta = (s: SignalRow): Record<string, any> => (s.meta ? JSON.parse(s.meta) : {});
const ageDays = (iso: string | null, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()) / DAY)) : 0);

export function todayData(db: DB, now = new Date()): TodayData {
  const today = now.toISOString().slice(0, 10);
  const companies = db.prepare(`
    SELECT c.id, c.name, c.status, c.discard_reason, c.snoozed_until, c.outreach, c.outreach_at, c.cnpj, c.sector, c.state, s.total
    FROM companies c LEFT JOIN scores s ON s.company_id = c.id
    WHERE c.excluded_reason IS NULL AND c.status <> 'descartado'`).all() as unknown as CompanyRow[];
  const signalsOf = db.prepare('SELECT company_id, type, subtype, title, url, source, published_at, collected_at, last_seen_at, meta FROM signals WHERE company_id = ?');
  const contactsOf = db.prepare('SELECT name, role, since, origin FROM contacts WHERE company_id = ? AND opt_out = 0 ORDER BY since DESC');

  const out: TodayData = { improve: [], agil: [], keep: [], followUps: [], installedBase: 0 };
  for (const c of companies) {
    // Em andamento: lembrar de cobrar quem não respondeu.
    if (c.outreach === 'contatado' || c.outreach === 'respondeu') {
      const days = ageDays(c.outreach_at, now);
      out.followUps.push({ id: c.id, name: c.name, outreach: c.outreach, days, late: days >= FOLLOW_UP_DAYS, status: c.status, discard_reason: c.discard_reason, snoozed_until: c.snoozed_until });
      continue;
    }
    if (c.outreach === 'reuniao' || (c.snoozed_until && c.snoozed_until > today)) continue;

    const sig = signalsOf.all(c.id) as unknown as SignalRow[];
    const contacts = contactsOf.all(c.id) as unknown as TodayItem['contacts'];
    const base = { id: c.id, name: c.name, total: c.total, status: c.status, outreach: c.outreach, discard_reason: c.discard_reason, snoozed_until: c.snoozed_until, contacts };

    // Improve: vaga Salesforce de time técnico ainda aberta.
    // Fora: banco de talentos / cadastro reserva e vagas "permanentes" (abertas há mais de 180 dias),
    // que não são contratação de verdade.
    const openJobs = sig.filter((s) => s.type === 'vaga' && meta(s).salesforce !== false && IMPROVE_ROLES.includes(s.subtype ?? '')
      && ageDays(s.last_seen_at, now) <= STILL_OPEN_DAYS
      && !EVERGREEN_TITLE.test(s.title) && ageDays(s.published_at ?? s.collected_at, now) <= MAX_REAL_OPEN_DAYS)
      .sort((a, b) => ageDays(b.published_at ?? b.collected_at, now) - ageDays(a.published_at ?? a.collected_at, now));
    const sfTech = sig.filter((s) => (s.type === 'tecnologia' && meta(s).vendorKind !== 'concorrente') || s.source === 'salesforce-casos');
    if (sfTech.length) out.installedBase++;

    if (openJobs.length) {
      const j = openJobs[0];
      const days = ageDays(j.published_at ?? j.collected_at, now);
      const clouds = [...new Set(openJobs.flatMap((s) => (meta(s).clouds as string[] | undefined) ?? []))].filter((x) => !x.includes('não especificada'));
      out.improve.push({
        ...base, offer: 'Improve', evidenceUrl: j.url,
        reason: `Vaga "${j.title}" aberta há ${days} dia(s)${openJobs.length > 1 ? `; ${openJobs.length} vagas Salesforce abertas` : ''}`,
        // A nota manda (perfil + sinais); tempo de vaga aberta e número de vagas desempatam.
        priority: (c.total ?? 0) + Math.min(days, 90) / 3 + 5 * Math.min(openJobs.length - 1, 5),
        draft: draftMessage({ company: c.name, offer: 'Improve', jobTitle: j.title, daysOpen: days, jobCount: openJobs.length, clouds }),
      });
      continue;
    }

    // Ágil: CRM concorrente, migração, fusão, diretoria nova, indicação.
    const comp = sig.find((s) => (s.type === 'vaga' && ((meta(s).crms as string[] | undefined) ?? []).length) || (s.type === 'tecnologia' && meta(s).vendorKind === 'concorrente'));
    const trig = sig.filter((s) => s.type === 'gatilho' && ageDays(s.published_at ?? s.collected_at, now) <= 120)
      .find((s) => ['fusao', 'lideranca', 'relacionamento', 'investimento', 'expansao'].includes(s.subtype ?? ''));
    const pain = sig.find((s) => ((meta(s).pain as { kind: string; label: string }[] | undefined) ?? []).some((p) => p.kind === 'migracao_crm' || p.kind === 'sistema_legado'));
    if (comp || trig || pain) {
      const crm = comp ? (comp.type === 'tecnologia' ? String(meta(comp).vendor) : ((meta(comp).crms as string[])[0])) : undefined;
      const where = comp ? (comp.type === 'tecnologia' ? `visto no ${meta(comp).how === 'site' ? 'site' : 'DNS'} da empresa` : `citado na vaga "${comp.title}"`) : undefined;
      const reason = comp ? `Usa ${crm} (${where})`
        : trig ? `${trig.title}`
          : `Vaga cita ${(meta(pain!).pain as { label: string }[])[0].label}`;
      out.agil.push({
        ...base, offer: 'Ágil', reason, evidenceUrl: (comp ?? trig ?? pain)!.url || null,
        priority: (c.total ?? 0) + (comp ? 10 : 0) + (trig ? 8 : 0),
        draft: draftMessage({
          company: c.name, offer: 'Ágil', competitor: crm, competitorWhere: where,
          trigger: !comp && trig ? { kind: trig.subtype ?? '', title: trig.title, source: trig.source } : undefined,
          painLabel: pain ? (meta(pain).pain as { label: string }[])[0].label : undefined,
        }),
      });
      continue;
    }

    // Keep: já usa Salesforce.
    if (sfTech.length) {
      const products = [...new Set(sfTech.map((s) => String(meta(s).vendor ?? s.title)
        .replace(/ \(caso de cliente publicado\)| \(e-mail da plataforma\)/, '')))];
      const how = sfTech.some((s) => s.source === 'salesforce-casos') ? 'há um caso de cliente publicado pela Salesforce'
        : `detectado no ${sfTech.some((s) => s.source === 'site') ? 'site' : 'DNS'} da empresa`;
      out.keep.push({
        ...base, offer: 'Keep', evidenceUrl: sfTech[0].url || null,
        reason: `Usa ${products.slice(0, 3).join(', ')} (${how})`,
        priority: (c.total ?? 0) + (sfTech.some((s) => s.source !== 'salesforce-casos') ? 5 : 0),
        draft: draftMessage({ company: c.name, offer: 'Keep', salesforceProducts: products, seenHow: how }),
      });
    }
  }
  const top = (xs: TodayItem[]) => xs.sort((a, b) => b.priority - a.priority).slice(0, PER_OFFER);
  out.improve = top(out.improve);
  out.agil = top(out.agil);
  out.keep = top(out.keep);
  out.followUps.sort((a, b) => b.days - a.days);
  return out;
}

const OFFER_INFO: Record<Offer, { title: string; why: string }> = {
  Improve: { title: 'Improve: alocação para quem está contratando', why: 'Vaga Salesforce aberta = orçamento aprovado e dor imediata. É a venda mais rápida: oferecer profissional alocado enquanto a empresa contrata.' },
  'Ágil': { title: 'Ágil: projeto (migração, integração, implantação)', why: 'CRM concorrente, migração, fusão ou diretoria nova. Ciclo mais longo, contrato maior.' },
  Keep: { title: 'Keep: sustentação para quem já usa Salesforce', why: 'Base instalada sem sinal de urgência: abordar com sustentação, melhoria contínua e novidades (Agentforce, Data Cloud).' },
};

function itemHtml(it: TodayItem, isStatic: boolean): string {
  const contacts = it.contacts.length
    ? it.contacts.slice(0, 3).map((p) => `${esc(p.name)}${p.role ? ` — ${esc(p.role)}` : ''}${p.since ? ` <span class="muted">(desde ${esc(p.since.split('-').reverse().join('/'))})</span>` : ''}`).join('<br>')
    : '<span class="muted">nenhum contato ainda: procure o cargo-alvo no LinkedIn (manualmente) e registre na página do lead</span>';
  return `<div class="signal" data-id="${it.id}">
  <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap">
    <span class="score ${scoreClass(it.total)}">${it.total ?? '—'}</span>
    <a href="/empresa/${it.id}"><strong>${esc(it.name)}</strong></a> ${statusChip(it)}
  </div>
  <div class="small" style="margin:4px 0">${extLink(it.evidenceUrl, esc(it.reason))}</div>
  <div class="small"><strong>Com quem falar:</strong> ${esc(it.draft.targetRole)}</div>
  <div class="small" style="margin-top:2px"><strong>Contatos:</strong> ${contacts}</div>
  <details style="margin-top:6px"><summary class="small">Rascunho de mensagem</summary>
    <div class="small muted" style="margin:6px 0 4px">Assunto: ${esc(it.draft.subject)}</div>
    <textarea readonly rows="9" style="width:100%">${esc(it.draft.body)}</textarea>
    <button type="button" class="btn secondary sm" data-copy>Copiar mensagem</button>
  </details>
  ${isStatic ? '' : `<div class="actions" style="margin-top:8px">${decisionButtons(it.id, it.status, true, it.outreach)}</div>`}
</div>`;
}

export function todayPage(d: TodayData, isStatic = false): string {
  const section = (offer: Offer, items: TodayItem[]) => `
<div class="card"><h2>${esc(OFFER_INFO[offer].title)} <span class="muted small">(${items.length})</span></h2>
  <p class="small muted" style="margin:0 0 8px">${esc(OFFER_INFO[offer].why)}</p>
  ${items.map((it) => itemHtml(it, isStatic)).join('') || '<p class="small muted">Nada nesta oferta agora.</p>'}
</div>`;
  const follow = d.followUps.length ? `
<div class="card"><h2>Retornos pendentes <span class="muted small">(${d.followUps.length})</span></h2>
  ${d.followUps.map((f) => `<div class="signal"><a href="/empresa/${f.id}"><strong>${esc(f.name)}</strong></a> ${statusChip(f)}
    <span class="small ${f.late ? 'run-bad' : 'muted'}">${f.outreach === 'respondeu' ? 'respondeu' : 'contatado'} há ${f.days} dia(s)${f.late ? ' — cobrar retorno' : ''}</span>
    ${isStatic ? '' : `<div class="actions" style="margin-top:6px">${decisionButtons(f.id, f.status, true, f.outreach)}</div>`}</div>`).join('')}
</div>` : '';
  return layout('Hoje · Radar', `
<div class="card" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
  <div><h2 style="margin:0;font-size:18px">Hoje</h2>
    <div class="small muted">Quem abordar agora, por oferta. Cada lead traz o motivo, com quem falar e um rascunho para você revisar e enviar.
      ${isStatic ? '' : 'Depois de enviar, marque <strong>Contatei</strong> para acompanhar o retorno.'}</div></div>
  <div class="actions"><a class="btn secondary" href="/co-venda.csv" download>Lista de co-venda (CSV)</a></div>
</div>
${follow}
${section('Improve', d.improve)}
${section('Ágil', d.agil)}
${section('Keep', d.keep)}
<p class="small muted">Base instalada (já usa Salesforce): ${d.installedBase} lead(s). A lista de co-venda junta quem usa Salesforce e tem sinal de momento, para levar aos executivos de contas da Salesforce.</p>
<script>
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copy]'); if (!b) return;
  var t = b.parentElement.querySelector('textarea'); t.select();
  (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.resolve(document.execCommand('copy')))
    .then(function () { if (window.radar) window.radar.toast('Mensagem copiada'); else b.textContent = 'Copiada'; });
});
${isStatic ? '' : "document.addEventListener('radar:decided', function () { setTimeout(function () { location.reload(); }, 500); });"}
</script>`, isStatic);
}

// Lista para co-venda com os executivos de contas da Salesforce: quem já usa Salesforce
// e tem um sinal de momento (vaga aberta, gatilho, CRM paralelo) — o que o executivo quer saber.
export function coSellCsv(db: DB, now = new Date()): string {
  const d = todayData(db, now);
  const rows = [...d.improve, ...d.agil, ...d.keep];
  const info = db.prepare('SELECT cnpj, sector, state, city FROM companies WHERE id = ?');
  return toCsv(
    ['empresa', 'cnpj', 'setor', 'uf', 'cidade', 'oferta_sottelli', 'sinal_de_momento', 'evidencia', 'nota', 'situacao'],
    rows.map((r) => {
      const c = info.get(r.id) as { cnpj: string | null; sector: string | null; state: string | null; city: string | null };
      return [r.name, c.cnpj, c.sector, c.state, c.city, r.offer, r.reason, r.evidenceUrl, r.total, r.outreach ?? r.status];
    }),
  );
}

export { TARGET_ROLE };
