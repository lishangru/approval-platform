// 统一显示时区：UTC+8（与服务器本地时区无关）
export function cstNow(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
