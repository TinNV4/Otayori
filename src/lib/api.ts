import liff from '@line/liff';

/**
 * Auth for the LIFF mini-app.
 * - Production: LIFF login → ID token sent as Bearer, verified server-side with LINE.
 * - Dev mode (no LIFF_ID): `x-dev-user-id` header; switch user with `?dev_user=U...`.
 */
let idToken: string | null = null;
let devUserId: string | null = null;

export interface PublicConfig {
  liff_id: string | null;
  dev_mode: boolean;
}

export async function initAuth(): Promise<PublicConfig> {
  const cfg: PublicConfig = await (await fetch('/api/config')).json();
  if (cfg.liff_id) {
    await liff.init({ liffId: cfg.liff_id });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return new Promise(() => undefined); // navigating away
    }
    idToken = liff.getIDToken();
  } else if (cfg.dev_mode) {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('dev_user');
    try {
      if (fromUrl) localStorage.setItem('dev_user', fromUrl);
      devUserId = fromUrl || localStorage.getItem('dev_user') || 'U_dev_parent';
    } catch {
      devUserId = fromUrl || 'U_dev_parent';
    }
  }
  return cfg;
}

export function currentDevUser() {
  return devUserId;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);
  else if (devUserId) headers.set('x-dev-user-id', devUserId);
  return fetch(path, { ...init, headers });
}
