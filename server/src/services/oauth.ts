import crypto from 'node:crypto';
import type { WorkflowEngine } from '../domain/flow/engine.js';

// ===== 第三方 OAuth2 登录（预留接口）=====
// 配置以下环境变量即启用（标准授权码流程，适配任意 OIDC/OAuth2 提供方）：
//   OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
//   OAUTH_AUTHORIZE_URL / OAUTH_TOKEN_URL / OAUTH_USERINFO_URL
//   OAUTH_USER_FIELD（可选，userinfo 里映射本平台账号的字段名，默认 username，可试 number/preferred_username）
//   FRONT_BASE（可选，登录成功后跳转的前端地址，默认 http://localhost:5173）

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  userField: string;
  frontBase: string;
}

export function oauthConfig(): OAuthConfig | null {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  const authorizeUrl = process.env.OAUTH_AUTHORIZE_URL;
  const tokenUrl = process.env.OAUTH_TOKEN_URL;
  const userinfoUrl = process.env.OAUTH_USERINFO_URL;
  if (!clientId || !clientSecret || !authorizeUrl || !tokenUrl || !userinfoUrl) return null;
  return {
    clientId, clientSecret, authorizeUrl, tokenUrl, userinfoUrl,
    userField: process.env.OAUTH_USER_FIELD ?? 'username',
    frontBase: process.env.FRONT_BASE ?? 'http://localhost:5173',
  };
}

// state 防csrf：内存 Map + 10 分钟过期
const states = new Map<string, number>();
export function createState(): string {
  const s = crypto.randomBytes(16).toString('hex');
  states.set(s, Date.now() + 10 * 60 * 1000);
  for (const [k, exp] of states) if (exp < Date.now()) states.delete(k);
  return s;
}
export function checkState(s: string): boolean {
  const exp = states.get(s);
  if (!exp || exp < Date.now()) return false;
  states.delete(s);
  return true;
}

export function buildAuthorizeUrl(cfg: OAuthConfig, redirectUri: string, state: string): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'openid profile');
  return u.toString();
}

export async function exchangeCode(cfg: OAuthConfig, code: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
  });
  const resp = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  const json = (await resp.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`token 交换失败: ${json.error ?? 'no access_token'}`);
  return json.access_token;
}

export async function fetchUserinfo(cfg: OAuthConfig, accessToken: string): Promise<Record<string, unknown>> {
  const resp = await fetch(cfg.userinfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  return (await resp.json()) as Record<string, unknown>;
}

// 第三方账号 → 本平台用户（按 userField 映射 username/number）
export function matchLocalUser(engine: WorkflowEngine, cfg: OAuthConfig, userinfo: Record<string, unknown>) {
  const val = String(userinfo[cfg.userField] ?? userinfo.username ?? userinfo.preferred_username ?? '').trim();
  return engine.users.find((u) => u.username === val || u.number === val);
}
