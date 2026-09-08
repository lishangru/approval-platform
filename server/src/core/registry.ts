// 通用策略注册表：所有可扩展点共用（组件/动作/审批人/路由）
// 两种用法：register('key', impl) 或 register(impl)（impl 自带 kind/code 作为 key）
export class Registry<T extends { kind?: string; code?: string }> {
  private map = new Map<string, T>();
  register(keyOrImpl: string | T, impl?: T, opts: { override?: boolean } = {}) {
    const key = typeof keyOrImpl === 'string' ? keyOrImpl : (keyOrImpl.kind ?? keyOrImpl.code ?? '');
    const value = typeof keyOrImpl === 'string' ? impl! : keyOrImpl;
    if (!key) throw new Error('策略缺少 kind/code 标识');
    if (this.map.has(key) && !opts.override) throw new Error(`"${key}" 已注册`);
    this.map.set(key, value);
  }
  get(key: string): T {
    const t = this.map.get(key);
    if (!t) throw new Error(`未注册的策略: "${key}"`);
    return t;
  }
  has(key: string) { return this.map.has(key); }
  keys() { return [...this.map.keys()]; }
}
