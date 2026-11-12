// Protege todo o site com senha (HTTP Basic). A senha vem da variável RADAR_SENHA
// configurada na Vercel; o usuário pode ser qualquer um (ou RADAR_USUARIO, se definido).
import { next } from '@vercel/functions';

export const config = { matcher: '/(.*)' };

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default function middleware(request: Request) {
  const senha = process.env.RADAR_SENHA;
  if (!senha) {
    // Sem senha configurada, nada é exibido (falha fechada).
    return new Response('RADAR_SENHA não configurada no projeto da Vercel.', { status: 503 });
  }
  const usuario = process.env.RADAR_USUARIO;
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const [u, ...resto] = atob(header.slice(6)).split(':');
      if (igual(resto.join(':'), senha) && (!usuario || igual(u, usuario))) return next();
    } catch {
      // cai no 401
    }
  }
  return new Response('Acesso restrito.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Radar Sottelli", charset="UTF-8"' },
  });
}
