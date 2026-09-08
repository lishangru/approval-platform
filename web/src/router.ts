import { createRouter, createWebHashHistory } from 'vue-router';
import { userStore } from './store';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue') },
    { path: '/oauth-callback', component: () => import('./views/OAuthCallback.vue') },
    {
      path: '/',
      component: () => import('./views/Layout.vue'),
      children: [
        { path: '', redirect: '/hall' },
        { path: 'hall', component: () => import('./views/Hall.vue') },
        { path: 'launch/:appId', component: () => import('./views/Launch.vue') },
        { path: 'mine', component: () => import('./views/MyInstances.vue') },
        { path: 'instance/:id', component: () => import('./views/InstanceDetail.vue') },
        { path: 'todo', component: () => import('./views/Todo.vue') },
        { path: 'deal/:taskId', component: () => import('./views/Deal.vue') },
        { path: 'finished', component: () => import('./views/Finished.vue') },
        { path: 'messages', component: () => import('./views/Messages.vue') },
        { path: 'reads', component: () => import('./views/MyReads.vue') },
        { path: 'admin/apps', component: () => import('./views/admin/AdminApps.vue') },
        { path: 'admin/users', component: () => import('./views/admin/AdminUsers.vue') },
        { path: 'admin/data/:appId', component: () => import('./views/admin/AdminData.vue') },
        { path: 'admin/form/:appId', component: () => import('./views/admin/AdminForm.vue') },
        { path: 'admin/flow/:appId', component: () => import('./views/admin/AdminFlow.vue') },
      ],
    },
  ],
});

router.beforeEach((to) => {
  if (to.path !== '/login' && to.path !== '/oauth-callback' && !userStore.user) return '/login';
});
