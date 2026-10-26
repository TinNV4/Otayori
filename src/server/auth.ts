import { NextFunction, Request, Response } from 'express';
import { AppConfig } from './config.ts';

export interface AuthedRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

export type IdTokenVerifier = (idToken: string) => Promise<{ sub: string; exp: number } | null>;

/** Verifies a LIFF ID token with LINE (https://developers.line.biz/en/reference/line-login/#verify-id-token). */
export function lineIdTokenVerifier(channelId: string): IdTokenVerifier {
  const cache = new Map<string, { sub: string; exp: number }>();
  return async (idToken: string) => {
    const hit = cache.get(idToken);
    if (hit && hit.exp * 1000 > Date.now()) return hit;
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sub: string; exp: number };
    if (cache.size > 1000) cache.clear();
    cache.set(idToken, data);
    return data;
  };
}

export function authMiddleware(cfg: AppConfig, verify: IdTokenVerifier | null) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    let userId: string | undefined;

    if (bearer && verify) {
      const claims = await verify(bearer).catch(() => null);
      userId = claims?.sub;
    } else if (cfg.devMode) {
      userId = (req.headers['x-dev-user-id'] as string) || undefined;
    }
    if (!userId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.userId = userId;
    req.isAdmin = cfg.adminUserIds.includes(userId) || (cfg.devMode && userId.startsWith('U_admin'));
    next();
  };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.isAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}
