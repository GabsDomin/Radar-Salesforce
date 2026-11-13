// Alertas de vaga do LinkedIn recebidos por e-mail pela própria pessoa.
// O radar NÃO acessa o LinkedIn (os termos proíbem coleta automatizada): lê só o texto dos e-mails
// de alerta que você salvou (.eml ou .txt). Cada vaga do e-mail traz título, empresa, local e link.
import fs from 'node:fs';
import path from 'node:path';
import type { JobPosting } from './types.ts';
import { detectCountry } from '../normalize/location.ts';

const JOB_LINK = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^\s>)"]*/gi;

// Quoted-printable (formato comum de .eml): quebras "=\n" e bytes "=C3=A7".
export function decodeQuotedPrintable(s: string): string {
  if (!/=[0-9A-F]{2}/.test(s) && !/=\r?\n/.test(s)) return s;
  const joined = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const NOISE = /^(ver vaga|view job|candidatura simplificada|easy apply|promovida|promoted|novo|new|\d+ (candidat|applicant)|há \d+|\d+ (dias?|days?|horas?|hours?) (atrás|ago)|recrutamento ativo|actively recruiting|.*conexão.*|.*connection.*)$/i;

export function parseLinkedInAlert(raw: string, receivedAt: string | null = null): JobPosting[] {
  const text = decodeQuotedPrintable(raw).replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&');
  const out: JobPosting[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(JOB_LINK)) {
    const id = m[1];
    if (seen.has(id)) continue;
    // As linhas antes do link são, de cima para baixo: título, empresa, local (ignorando ruído).
    const before = text.slice(Math.max(0, m.index! - 600), m.index).split(/\r?\n/)
      .map((l) => l.trim().replace(/\s*:$/, '')).filter((l) => l && !NOISE.test(l) && !/^https?:/.test(l) && l.length < 120);
    const [title, company, location] = before.slice(-3);
    if (!title || !company) continue;
    seen.add(id);
    const [city, state] = (location ?? '').split(',').map((x) => x.trim());
    out.push({
      source: 'linkedin-alerta',
      externalId: id,
      title,
      description: title, // o alerta não traz a descrição; o título decide se é vaga de CRM
      companyName: company,
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      publishedAt: receivedAt,
      city: city || null,
      state: state || null,
      country: detectCountry(city, state, location?.split(',').pop()?.trim()) ?? 'desconhecido',
      documentId: null,
    });
  }
  return out;
}

export function readAlertFolder(dir: string): JobPosting[] {
  if (!fs.existsSync(dir)) return [];
  const all: JobPosting[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => /\.(eml|txt|html?)$/i.test(n))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const date = raw.match(/^Date:\s*(.+)$/m)?.[1];
    const received = date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : fs.statSync(path.join(dir, f)).mtime.toISOString();
    for (const p of parseLinkedInAlert(raw, received)) if (!all.some((a) => a.externalId === p.externalId)) all.push(p);
  }
  return all;
}
