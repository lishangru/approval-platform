import { computed, reactive } from 'vue';

export interface UserState { uid: number; name: string; number: string; department: string; roles: string[] }

const saved = localStorage.getItem('user');
export const userStore = reactive<{ user: UserState | null }>({
  user: saved ? JSON.parse(saved) : null,
});

export const isAdmin = computed(() => Boolean(userStore.user?.roles?.includes('admin')));

export function setUser(user: UserState, token: string) {
  userStore.user = user;
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('token', token);
}

export function logout() {
  userStore.user = null;
  localStorage.removeItem('user');
  localStorage.removeItem('token');
}
