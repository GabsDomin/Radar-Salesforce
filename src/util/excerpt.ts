// Trechos de evidência legíveis: sempre frases inteiras, nunca palavra cortada.
// O trecho começa no início da frase que contém o termo e termina no fim dela; se a frase for curta,
// junta a frase seguinte (ou a anterior) para dar contexto.

// HTML → texto preservando a separação de parágrafos e itens de lista (viram quebra de linha).
export function htmlToText(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div|\/tr|li|p|h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // O Greenhouse escapa duas vezes: depois do primeiro passo ainda sobram entidades como &nbsp;.
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

// Texto limpo para recorte: entidades decodificadas, espaços normalizados, quebras de linha mantidas.
export function cleanForExcerpt(s: string): string {
  return s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim();
}

interface Sentence { start: number; end: number }

// Frases: terminam em . ! ? seguido de espaço, em quebra de linha ou em marcador de lista.
function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  // Também "frase.Outra frase" (itens de lista colados no HTML de origem): ponto entre minúscula e maiúscula.
  // "!" e "?" colados em maiúscula ("B2B!Responsabilidades") também separam.
  const re = /[.!?](?=\s)|(?<=[a-zà-ÿ)])[.!?](?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])|[!?](?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])|\n|\s[•·▪►]\s/g;
  let start = 0;
  for (const m of text.matchAll(re)) {
    const end = m.index! + (/^[.!?]$/.test(m[0]) ? 1 : 0); // pontuação fica na frase; quebra/marcador não
    if (end > start) out.push({ start, end });
    start = m.index! + m[0].length;
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out.map((s) => {
    let a = s.start, b = s.end;
    while (a < b && /[\s•·▪►\-–—*]/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    return { start: a, end: b };
  }).filter((s) => s.end > s.start);
}

// Corta uma frase longa demais em limite de palavra, mantendo o termo no meio.
function trimLong(text: string, from: number, to: number, idx: number, len: number, max: number): string {
  const half = Math.max(0, Math.floor((max - len) / 2));
  let a = Math.max(from, idx - half);
  let b = Math.min(to, idx + len + half);
  if (a > from) { const sp = text.indexOf(' ', a); a = sp >= 0 && sp < idx ? sp + 1 : a; }
  if (b < to) { const sp = text.lastIndexOf(' ', b); b = sp > idx + len ? sp : b; }
  return (a > from ? '… ' : '') + text.slice(a, b).trim() + (b < to ? ' …' : '');
}

const join = (parts: string[]) => parts.map((p) => p.trim()).filter(Boolean)
  .map((p, i, arr) => (i < arr.length - 1 && !/[.!?:;]$/.test(p) ? p + '.' : p)).join(' ');

/**
 * Frase(s) inteiras em torno de text[idx, idx+len).
 * @param minLen se a frase do termo for menor que isso, junta a vizinha
 * @param max    limite total; uma frase única maior que isso é cortada em limite de palavra
 */
export function excerptAround(text: string, idx: number, len: number, minLen = 140, max = 480): string {
  const ss = sentences(text);
  let i = ss.findIndex((s) => idx < s.end);
  if (i < 0) i = ss.length - 1;
  if (i < 0) return '';
  const own = ss[i];
  if (own.end - own.start > max) return trimLong(text, own.start, own.end, Math.max(idx, own.start), len, max);
  let first = i, last = i;
  const size = () => ss[last].end - ss[first].start;
  while (size() < minLen) {
    const next = last + 1 < ss.length && ss[last + 1].end - ss[first].start <= max;
    const prev = first > 0 && ss[last].end - ss[first - 1].start <= max;
    if (next) last++;
    else if (prev) first--;
    else break;
  }
  return join(ss.slice(first, last + 1).map((s) => text.slice(s.start, s.end)));
}

// Primeiro trecho que casa com o padrão, em frases inteiras; sem casamento, as primeiras frases.
export function excerptFor(raw: string, re: RegExp, minLen?: number, max?: number): string {
  const text = cleanForExcerpt(raw);
  const m = re.exec(text);
  return excerptAround(text, m ? m.index : 0, m ? m[0].length : 0, minLen, max);
}

// Normaliza (minúsculas, sem acento) mantendo o mapa para a posição no texto original:
// assim um padrão procurado no texto normalizado aponta o trecho certo no original.
export function normalizedWithMap(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) { norm += n[k]; map.push(i); }
  }
  map.push(text.length);
  return { norm, map };
}

// Trecho antigo já gravado no banco ("…omo parte de… Experiencia…"): tira os pedaços de palavra das pontas.
export function tidyStoredSnippet(s: string): string {
  let t = s.trim()
    .replace(/([a-zà-ÿ)])([.!?])([A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, '$1$2 $3') // "Experience.Experiência"
    .replace(/([!?])([A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, '$1 $2');              // "B2B!Responsabilidades"
  const cutStart = t.startsWith('…');
  if (cutStart) {
    t = t.slice(1);
    const cut = t.search(/[.!?:;]\s|\n/);
    t = cut >= 0 && cut < 120 ? t.slice(cut + 1) : t.slice(Math.max(0, t.indexOf(' ') + 1));
    t = t.trim().replace(/^[•·▪►\-–—*,]\s*/, '');
  }
  if (t.endsWith('…')) {
    t = t.slice(0, -1).trimEnd();
    const lastEnd = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('.'));
    if (lastEnd >= 0 && t.length - lastEnd < 160 && lastEnd > t.length / 3) t = t.slice(0, lastEnd + 1);
    else { const sp = t.lastIndexOf(' '); t = (sp > 0 ? t.slice(0, sp) : t).replace(/[,;:\-–—(]+$/, '') + ' …'; }
  }
  return cutStart ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
