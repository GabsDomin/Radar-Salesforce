import type { DB } from '../db/index.ts';
import { toCsv } from '../util/csv.ts';
import { listCompanies, type Filters } from './queries.ts';
import type { BreakdownItem, OfferSuggestion } from '../scoring/score.ts';

export function exportCsv(db: DB, filters: Filters): string {
  const rows = listCompanies(db, filters);
  const linksOf = db.prepare("SELECT url FROM signals WHERE company_id = ? ORDER BY COALESCE(published_at, collected_at) DESC LIMIT 5");
  return toCsv(
    ['empresa', 'nota', 'aderencia', 'sinal', 'ofertas', 'setor', 'origem_setor', 'cidade', 'uf', 'status', 'etapa',
      'excluida', 'qtd_vagas', 'ultimo_sinal', 'explicacao', 'evidencias'],
    rows.map((r) => {
      const offers: OfferSuggestion[] = r.offers ? JSON.parse(r.offers) : [];
      const bd: BreakdownItem[] = r.breakdown ? JSON.parse(r.breakdown) : [];
      return [
        r.name, r.total, r.fit, r.signal, offers.map((o) => o.offer).join(', '), r.sector, r.sector_source,
        r.city, r.state, r.status, r.stage, r.excluded_reason, r.job_count, r.last_signal_at,
        bd.filter((b) => b.points !== 0).map((b) => `${b.points > 0 ? '+' : ''}${b.points} ${b.rule}: ${b.reason}`).join(' | '),
        (linksOf.all(r.id) as { url: string }[]).map((l) => l.url).join(' '),
      ];
    }),
  );
}
