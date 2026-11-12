// Grava notícias com gatilho como sinais do tipo 'gatilho'.
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import type { CompanyNews } from '../sources/news.ts';

export interface NewsStats { received: number; newSignals: number; updatedSignals: number }

const KIND_LABEL = { lideranca: 'Troca de liderança', fusao: 'Fusão/aquisição', investimento: 'Investimento', expansao: 'Expansão' } as const;

export function ingestNews(db: DB, news: CompanyNews[]): NewsStats {
  const stats: NewsStats = { received: news.length, newSignals: 0, updatedSignals: 0 };
  const find = db.prepare('SELECT id FROM signals WHERE source = ? AND external_id = ?');
  const insert = db.prepare(`
    INSERT INTO signals (company_id, type, subtype, title, evidence, url, source, external_id, company_raw, published_at, meta, review_flag)
    VALUES (?, 'gatilho', ?, ?, ?, ?, 'gdelt', ?, ?, ?, ?, ?)`);
  const touch = db.prepare("UPDATE signals SET last_seen_at = datetime('now') WHERE id = ?");

  tx(db, () => {
    for (const n of news) {
      const externalId = `${n.companyId}:${n.item.url}`;
      const existing = find.get('gdelt', externalId) as { id: number } | undefined;
      if (existing) { touch.run(existing.id); stats.updatedSignals++; continue; }
      const c = n.classification;
      const meta = JSON.stringify({
        kind: c.kind, area: c.area, mentionsSalesforce: c.mentionsSalesforce,
        domain: n.item.domain, documentId: n.item.documentId,
      });
      // Nome de uma palavra só é ambíguo (ex.: "Natura"): pede confirmação humana.
      const oneWord = !/\s/.test(n.companyName.trim());
      insert.run(
        n.companyId, c.kind, `${KIND_LABEL[c.kind]}: ${n.item.title}`, `${n.item.title} (${n.item.domain})`,
        n.item.url, externalId, n.companyName, n.item.publishedAt, meta,
        oneWord ? 'nome curto: confirmar que a notícia é da mesma empresa' : null,
      );
      stats.newSignals++;
    }
  });
  return stats;
}
