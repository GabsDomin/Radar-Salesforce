// Etapa "tecnologia": cruza a base da CVM com os leads e detecta CRM/marketing no DNS e no site.
// - Lead que já existe e está na CVM ganha CNPJ, domínio e setor confirmado.
// - Empresa da CVM (setor do perfil) que ainda não é lead só entra se a detecção achar algo.
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import type { PoliteClient } from '../http/client.ts';
import { fetchCvm, type CvmCompany } from '../sources/cvm.ts';
import { detectTech, type DnsResolver, type TechHit } from '../tech/detect.ts';
import { findCompanyId, upsertCompany, exclusionFor } from './companies.ts';
import { collectCustomerStories, type CustomerStory } from '../sources/customerStories.ts';
import { normalizeCompanyName } from '../normalize/company.ts';

export interface TechStats {
  cvmInProfile: number;
  leadsEnriched: number;
  domainsScanned: number;
  withSalesforce: number;
  withCompetitor: number;
  newLeads: number;
  newSignals: number;
}

type Log = (m: string) => void;

function saveHits(db: DB, companyId: number, domain: string, hits: TechHit[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO signals (company_id, type, subtype, title, evidence, url, source, external_id, company_raw, meta)
    VALUES (?, 'tecnologia', ?, ?, ?, ?, ?, ?, ?, ?)`);
  const touch = db.prepare("UPDATE signals SET last_seen_at = datetime('now') WHERE source = ? AND external_id = ?");
  let created = 0;
  for (const h of hits) {
    const source = h.how === 'site' ? 'site' : h.how === 'caso publicado' ? 'salesforce-casos' : 'dns';
    const externalId = `${companyId}:${h.vendor}`;
    const r = insert.run(companyId, h.vendorKind, h.vendor, h.evidence.slice(0, 400), h.url, source, externalId, domain,
      JSON.stringify({ vendor: h.vendor, vendorKind: h.vendorKind, how: h.how, domain }));
    if (Number(r.changes)) created++;
    else touch.run(source, externalId);
  }
  return created;
}

export async function runTech(
  db: DB, client: PoliteClient, log: Log, opts: { cvm?: CvmCompany[]; resolver?: DnsResolver } = {},
): Promise<TechStats> {
  const cvm = opts.cvm ?? await fetchCvm(client);
  const stats: TechStats = { cvmInProfile: cvm.length, leadsEnriched: 0, domainsScanned: 0, withSalesforce: 0, withCompetitor: 0, newLeads: 0, newSignals: 0 };
  log(`CVM: ${cvm.length} companhia(s) aberta(s) no perfil (financeiro, indústria, agro).`);

  // 1) Leads existentes que estão na CVM: CNPJ, domínio e setor confirmado.
  const enrich = db.prepare(`UPDATE companies SET cnpj = COALESCE(cnpj, ?), domain = COALESCE(domain, ?),
    sector = ?, sector_source = ?, updated_at = datetime('now') WHERE id = ?`);
  const cvmByLead = new Map<number, CvmCompany>();
  // Nome na CVM pode ser antigo ("Banco UBS Pactual"): o domínio liga ao lead ("BTG Pactual" ↔ btgpactual.com).
  const compact = (s: string) => normalizeCompanyName(s).replace(/\s+/g, '');
  const leadsByCompactName = new Map(
    (db.prepare('SELECT id, name FROM companies').all() as { id: number; name: string }[]).map((l) => [compact(l.name), l.id]),
  );
  const leadIdFor = (c: CvmCompany): number | null =>
    findCompanyId(db, c.name) ?? (c.domain ? leadsByCompactName.get(c.domain.split('.')[0]) ?? null : null);
  tx(db, () => {
    for (const c of cvm) {
      const id = leadIdFor(c);
      if (id === null) continue;
      enrich.run(c.cnpj, c.domain, c.sector, `cvm: ${c.cvmSector}`, id);
      cvmByLead.set(id, c);
      stats.leadsEnriched++;
    }
  });

  // 2) Alvos da detecção: leads com domínio + empresas da CVM com domínio que ainda não são leads.
  const leads = db.prepare('SELECT id, name, domain FROM companies WHERE excluded_reason IS NULL AND domain IS NOT NULL')
    .all() as { id: number; name: string; domain: string }[];
  const targets: { id: number | null; name: string; domain: string; cvm?: CvmCompany }[] = leads.map((l) => ({ ...l, cvm: cvmByLead.get(l.id) }));
  const leadDomains = new Set(leads.map((l) => l.domain));
  for (const c of cvm) {
    if (c.domain && !leadDomains.has(c.domain) && leadIdFor(c) === null && !exclusionFor(db, c.name)) {
      targets.push({ id: null, name: c.name, domain: c.domain, cvm: c });
      leadDomains.add(c.domain);
    }
  }
  log(`Detectando tecnologia em ${targets.length} domínio(s)...`);

  const setNew = db.prepare(`UPDATE companies SET cnpj = ?, domain = ?, sector = ?, sector_source = ?, size_band = '100+',
    size_source = 'inferido: companhia aberta na CVM', city = COALESCE(city, ?), state = COALESCE(state, ?) WHERE id = ?`);
  for (const t of targets) {
    stats.domainsScanned++;
    const hits = await detectTech(client, t.domain, opts.resolver);
    if (!hits.length) continue;
    if (hits.some((h) => h.vendorKind === 'salesforce')) stats.withSalesforce++;
    if (hits.some((h) => h.vendorKind === 'concorrente')) stats.withCompetitor++;
    let id = t.id;
    if (id === null) {
      id = upsertCompany(db, t.name, 'cvm');
      const c = t.cvm!;
      setNew.run(c.cnpj, c.domain, c.sector, `cvm: ${c.cvmSector}`, c.city, c.state, id);
      stats.newLeads++;
    }
    stats.newSignals += saveHits(db, id, t.domain, hits);
    log(`${t.name} (${t.domain}): ${hits.map((h) => `${h.vendor} [${h.how}]`).join(', ')}`);
  }
  return stats;
}

export interface CasesStats { stories: number; latam: number; newLeads: number; existingLeads: number; excluded: number; newSignals: number }

// Casos de clientes publicados pela Salesforce Brasil: empresa do Brasil/América Latina vira lead
// com "Tecnologia Salesforce" confirmada (o caso público é a evidência).
export async function runCases(db: DB, client: PoliteClient, log: Log, stories?: CustomerStory[]): Promise<CasesStats> {
  const all = stories ?? await collectCustomerStories(client, log);
  const latam = all.filter((s) => s.latam);
  const stats: CasesStats = { stories: all.length, latam: latam.length, newLeads: 0, existingLeads: 0, excluded: 0, newSignals: 0 };
  for (const s of latam) {
    if (exclusionFor(db, s.company)) { stats.excluded++; continue; }
    const existed = findCompanyId(db, s.company) !== null;
    const id = upsertCompany(db, s.company, 'salesforce-casos');
    if (existed) stats.existingLeads++; else stats.newLeads++;
    stats.newSignals += saveHits(db, id, '', [{
      vendor: 'Salesforce (caso de cliente publicado)', vendorKind: 'salesforce', how: 'caso publicado',
      evidence: [s.title, s.description].filter(Boolean).join(' — '), url: s.url,
    }]);
  }
  log(`Casos: ${all.length} página(s), ${latam.length} do Brasil/América Latina, ${stats.newLeads} lead(s) novo(s).`);
  return stats;
}
