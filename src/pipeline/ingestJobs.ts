// Grava vagas coletadas como sinais ligados a contas.
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import { classifyJob } from '../classify/job.ts';
import { isIdentifiableCompany } from '../normalize/company.ts';
import type { JobPosting } from '../sources/types.ts';
import { upsertCompany, exclusionFor } from './companies.ts';

export interface IngestStats {
  received: number;
  notSalesforce: number;
  unidentified: number;
  excluded: number;
  flaggedConsultancy: number;
  newSignals: number;
  updatedSignals: number;
}

export function ingestJobs(db: DB, postings: JobPosting[]): IngestStats {
  const stats: IngestStats = {
    received: postings.length, notSalesforce: 0, unidentified: 0, excluded: 0,
    flaggedConsultancy: 0, newSignals: 0, updatedSignals: 0,
  };

  const findSignal = db.prepare('SELECT id FROM signals WHERE source = ? AND external_id = ?');
  const insertSignal = db.prepare(`
    INSERT INTO signals (company_id, type, subtype, title, evidence, url, source, external_id, company_raw,
                         published_at, meta, review_flag)
    VALUES (?, 'vaga', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const touchSignal = db.prepare(`
    UPDATE signals SET last_seen_at = datetime('now'), meta = ?, review_flag = ?, company_id = ? WHERE id = ?`);
  const setSector = db.prepare(`
    UPDATE companies SET sector = ?, sector_source = ?, updated_at = datetime('now')
    WHERE id = ? AND (sector IS NULL OR sector_source LIKE 'inferido%')`);
  const setLocation = db.prepare(`
    UPDATE companies SET city = COALESCE(city, ?), state = COALESCE(state, ?) WHERE id = ?`);
  const setExcluded = db.prepare("UPDATE companies SET excluded_reason = ?, updated_at = datetime('now') WHERE id = ?");

  tx(db, () => {
    for (const p of postings) {
      const c = classifyJob(p.title, p.description);
      if (!c.isSalesforce) { stats.notSalesforce++; continue; }

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
        supportHints: c.supportHints, city: p.city, state: p.state, country: p.country, documentId: p.documentId,
      });
      const existing = findSignal.get(p.source, p.externalId) as { id: number } | undefined;
      if (existing) {
        touchSignal.run(meta, reviewFlag, companyId, existing.id);
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
  return stats;
}

// Trecho da descrição em torno da primeira menção a Salesforce, para servir de evidência.
export function evidenceSnippet(description: string, radius = 160): string {
  const text = description.replace(/\s+/g, ' ').trim();
  const idx = text.search(/salesforce|marketing cloud|service cloud|sales cloud|pardot|apex|lwc/i);
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  return (start > 0 ? '…' : '') + text.slice(start, idx + radius) + (idx + radius < text.length ? '…' : '');
}
