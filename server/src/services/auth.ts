import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { Principal } from '../core/types.js';
import type { WorkflowEngine } from '../domain/flow/engine.js';

const SECRET = process.env.APP_JWT_SECRET || 'dev-secret-change-me';

export function hashPassword(password: string, salt: string): string {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

export function makeSalt(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function signToken(payload: { uid: number }, expiresIn = '12h'): string {
  return jwt.sign(payload, SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): { uid: number } {
  return jwt.verify(token, SECRET) as { uid: number };
}

// 未来接入 CAS/OIDC：实现此接口替换 localLogin 即可（CAS 流程见《CAS登录流程.md》）
export interface AuthAdapter {
  readonly kind: string;
  login(body: { username: string; password: string }, engine: WorkflowEngine): { token: string; principal: Principal } | null;
}

export const localAuth: AuthAdapter = {
  kind: 'local',
  login(body, engine) {
    const u = engine.users.find((r) => r.username === body.username);
    if (!u || u.passHash !== hashPassword(body.password, u.salt)) return null;
    if (u.status === 'disabled') throw new Error('账号已被禁用，请联系管理员');
    const principal = engine.principalOf(u.id);
    return { token: signToken({ uid: u.id }), principal };
  },
};

// —— 中间件工厂 ——
export function authRequired(engine: WorkflowEngine) {
  return (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token as string) ?? '';
    if (!token) return res.status(401).json({ e: 40100, m: '未登录', d: null });
    try {
      const { uid } = verifyToken(token);
      (req as any).principal = engine.principalOf(uid);
      next();
    } catch {
      return res.status(401).json({ e: 40101, m: '登录已过期', d: null });
    }
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = (req as any).principal as Principal;
    if (!roles.some((r) => p.roles.includes(r))) return res.status(403).json({ e: 40300, m: '无权访问（需要管理端权限）', d: null });
    next();
  };
}

// TOTP 二次验证钩子（对应 ehall /system 管理端）——默认关闭，接入时实现 verify 函数
export interface TotpVerifier { verify(principal: Principal, code: string): boolean }
export const noTotp: TotpVerifier = { verify: () => true };
export const TOTP_ENABLED = process.env.APP_TOTP_REQUIRED === '1';

export function requireTotp(engine: WorkflowEngine, verifier: TotpVerifier = noTotp) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!TOTP_ENABLED) return next();
    const p = (req as any).principal as Principal;
    const code = (req.headers['x-totp'] as string) ?? '';
    if (!verifier.verify(p, code)) return res.status(403).json({ e: 30000, m: '动态口令验证未通过', d: null });
    next();
  };
}
