// Interpretação de robots.txt (RFC 9309): grupo mais específico de user-agent,
// regra Allow/Disallow com o caminho mais longo vence, empate favorece Allow.

interface Rule { allow: boolean; pattern: string }

export interface Robots {
  isAllowed(pathAndQuery: string): boolean;
  crawlDelaySec?: number;
}

export function parseRobots(text: string, userAgent: string): Robots {
  const agentToken = userAgent.split('/')[0].toLowerCase();
  const groups: { agents: string[]; rules: Rule[]; delay?: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // "Disallow:" vazio significa "tudo liberado".
      if (value !== '') current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.delay = n;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agentToken.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.find((g) => g.delay !== undefined)?.delay;

  return {
    crawlDelaySec: delay,
    isAllowed(pathAndQuery: string) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!matches(rule.pattern, pathAndQuery)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

function matches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + regex + (anchored ? '$' : '')).test(target);
}
