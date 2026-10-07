// Normalização de nomes de empresa para deduplicar ("Grupo Suno" = "Suno S.A." = "suno").

const LEGAL_SUFFIXES = [
  'ltda', 'limitada', 'sa', 's a', 'eireli', 'me', 'epp', 'mei', 'cia', 'companhia', 'inc', 'llc', 'ltd',
];
const NOISE_WORDS = ['grupo', 'group', 'jobs', 'carreiras', 'carreira', 'careers', 'vagas', 'talentos', 'oficial'];

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeCompanyName(name: string): string {
  let s = stripAccents(name).toLowerCase();
  s = s.replace(/&/g, ' e ');
  s = s.replace(/s\/a\b/g, ' sa ').replace(/\bs\.a\.?/g, ' sa ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = s.split(' ').filter(Boolean);
  // Remove sufixos societários do final e palavras de ruído em qualquer posição.
  while (tokens.length > 1 && LEGAL_SUFFIXES.includes(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length > 1 && tokens[tokens.length - 1] === 's' && tokens[tokens.length - 2] === 'a') tokens.splice(-2);
  const cleaned = tokens.filter((t) => !NOISE_WORDS.includes(t));
  return (cleaned.length ? cleaned : tokens).join(' ');
}

// Nomes que não identificam uma empresa (vaga confidencial, cidade, programa de vagas).
const UNKNOWN_PATTERNS = [
  /confidencial/i,
  /sigilos/i,
  /empresa (parceira|cliente)/i,
  /^[\p{L} ]+\/[A-Z]{2}$/u, // "São Paulo/SP"
  /international experience/i,
  /banco de talentos/i,
];

export function isIdentifiableCompany(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return false;
  return !UNKNOWN_PATTERNS.some((re) => re.test(name.trim()));
}
