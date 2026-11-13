// Grava vagas coletadas como sinais ligados a contas.
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import { classifyJob } from '../classify/job.ts';
import { isIdentifiableCompany, looksLikeConsultancyName } from '../normalize/company.ts';
import { isAllowedCountry } from '../normalize/location.ts';
import type { JobPosting } from '../sources/types.ts';
import { upsertCompany, exclusionFor } from './companies.ts';
import { excerptFor } from '../util/excerpt.ts';

export interface IngestStats {
  received: number;
  notSalesforce: number;
  competitorCrm: number;  // vagas que citam só CRM concorrente (candidatas a migração)
  outOfRegion: number;   // fora do Brasil/América Latina
  skippedConsultancy: number;
  unidentified: number;
  excluded: number;
  flaggedConsultancy: number;
  newSignals: number;
  updatedSignals: number;
}

export function ingestJobs(db: DB, postings: JobPosting[]): IngestStats {
  const stats: IngestStats = {
    received: postings.length, notSalesforce: 0, competitorCrm: 0, outOfRegion: 0, skippedConsultancy: 0, unidentified: 0, excluded: 0,
    flaggedConsultancy: 0, newSignals: 0, updatedSignals: 0,
  };

  const findSignal = db.prepare('SELECT id FROM signals WHERE source = ? AND external_id = ?');
  const dropSignal = db.prepare('DELETE FROM signals WHERE source = ? AND external_id = ?');
  const insertSignal = db.prepare(`
    INSERT INTO signals (company_id, type, subtype, title, evidence, url, source, external_id, company_raw,
                         published_at, meta, review_flag)
    VALUES (?, 'vaga', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const touchSignal = db.prepare(`
    UPDATE signals SET last_seen_at = datetime('now'), meta = ?, review_flag = ?, company_id = ?, evidence = ? WHERE id = ?`);
  const setSector = db.prepare(`
    UPDATE companies SET sector = ?, sector_source = ?, updated_at = datetime('now')
    WHERE id = ? AND (sector IS NULL OR sector_source LIKE 'inferido%')`);
  const setLocation = db.prepare(`
    UPDATE companies SET city = COALESCE(city, ?), state = COALESCE(state, ?) WHERE id = ?`);
  const setExcluded = db.prepare("UPDATE companies SET excluded_reason = ?, updated_at = datetime('now') WHERE id = ?");

  tx(db, () => {
    for (const p of postings) {
      // Somente Brasil e América Latina.
      if (!isAllowedCountry(p.country)) { stats.outOfRegion++; continue; }
      const c = classifyJob(p.title, p.description);
      // Entra se cita Salesforce OU um CRM concorrente (candidata a migração).
      if (!c.isSalesforce && !c.competitorCrms.length) { stats.notSalesforce++; continue; }
      if (!c.isSalesforce) stats.competitorCrm++;
      // Consultorias, integradoras e recrutadoras não são prospects: nem entram no banco.
      if (c.consultancyStrong || looksLikeConsultancyName(p.companyName)) {
        // Se a vaga já tinha entrado antes de a regra existir, sai agora (a conta órfã é limpa no fim).
        dropSignal.run(p.source, p.externalId);
        stats.skippedConsultancy++;
        continue;
      }

      const identifiable = isIdentifiableCompany(p.companyName);
      if (!identifiable) stats.unidentified++;

      let companyId: number | null = null;
      if (identifiable) {
        companyId = upsertCompany(db, p.companyName, p.source);
        const exclusion = exclusionFor(db, p.companyName);
        if (exclusion) { setExcluded.run(exclusion, companyId); stats.excluded++; }
        if (c.sector) setSector.run(c.sector.sector, `inferido: vaga cita "${c.sector.evidence}"`, companyId);
        setLocation.run(p.city, p.state, companyId);
      }

      const reviewFlag = !identifiable
        ? 'empresa não identificada (vaga confidencial)'
        : c.consultancyReasons.length
          ? `possível consultoria/recrutadora: ${c.consultancyReasons.join('; ')}`
          : null;
      if (identifiable && c.consultancyReasons.length) stats.flaggedConsultancy++;

      const meta = JSON.stringify({
        role: c.role, senior: c.senior, clouds: c.clouds, projectHints: c.projectHints,
        supportHints: c.supportHints, pain: c.pain,
        salesforce: c.isSalesforce, crms: c.competitorCrms, opsRole: c.opsRole, city: p.city, state: p.state, country: p.country, documentId: p.documentId,
      });
      const existing = findSignal.get(p.source, p.externalId) as { id: number } | undefined;
      if (existing) {
        touchSignal.run(meta, reviewFlag, companyId, evidenceSnippet(p.description), existing.id);
        stats.updatedSignals++;
      } else {
        insertSignal.run(
          companyId, c.role, p.title, evidenceSnippet(p.description), p.url, p.source, p.externalId,
          p.companyName, p.publishedAt, meta, reviewFlag,
        );
        stats.newSignals++;
      }
    }
  });
  purgeConsultancies(db);
  return stats;
}

// Remove o que foi gravado antes desta regra: vagas marcadas com indício forte de consultoria
// e contas que ficaram sem nenhum sinal (e sem acompanhamento feito por uma pessoa).
export function purgeConsultancies(db: DB): { signals: number; companies: number } {
  const strong = ['vaga de alocação', 'descreve-se como consultoria', 'parceira Salesforce', 'vaga de recrutadora', 'time de delivery para clientes', 'agência ou parceira de CRM', 'consultoria (vaga em espanhol)'];
  const like = strong.map(() => 'review_flag LIKE ?').join(' OR ');
  const params = strong.map((r) => `%${r}%`);
  const signals = Number(db.prepare(`DELETE FROM signals WHERE review_flag LIKE 'possível consultoria%' AND (${like})`).run(...params).changes);
  const companies = Number(db.prepare(`
    DELETE FROM companies WHERE id NOT IN (SELECT DISTINCT company_id FROM signals WHERE company_id IS NOT NULL)
      AND status = 'novo' AND stage = 'radar' AND notes IS NULL AND next_action IS NULL`).run().changes);
  return { signals, companies };
}

// Frase(s) inteiras da descrição em torno da primeira menção a Salesforce/CRM, para servir de evidência.
const EVIDENCE_TERM = /salesforce|marketing cloud|service cloud|sales cloud|pardot|apex|lwc|hubspot|rd ?station|dynamics|zoho|pipedrive|sap crm|c4c|siebel|marketo|ploomes|agendor|bitrix/i;
export function evidenceSnippet(description: string): string {
  return excerptFor(description, EVIDENCE_TERM);
}
