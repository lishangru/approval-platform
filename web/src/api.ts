import axios from 'axios';

export interface ApiResp<T = any> { e: number; m: string; d: T }

const http = axios.create({ baseURL: '/', timeout: 15000 });

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = 'Bearer ' + token;
  return cfg;
});

http.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const data = err.response?.data;
    if (data?.e === 40100 || data?.e === 40101) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (location.hash !== '#/login') location.hash = '#/login';
    }
    return Promise.reject(err);
  },
);

export async function api<T = any>(method: 'get' | 'post', url: string, data?: any): Promise<T> {
  const resp = await http.request<ApiResp<T>>({ method, url, data });
  const body = resp.data;
  if (body.e !== 0) throw Object.assign(new Error(body.m || '请求失败'), { resp: body });
  return body.d;
}

// 允许业务层读取 e!=0 的完整响应（如表单校验 e=10049）
export async function apiRaw<T = any>(method: 'get' | 'post', url: string, data?: any): Promise<ApiResp<T>> {
  const resp = await http.request<ApiResp<T>>({ method, url, data });
  return resp.data;
}
