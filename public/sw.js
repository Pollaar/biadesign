// Service worker do painel: recebe as notificações mesmo com o painel fechado.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Novo pedido';
  const tasks = [
    self.registration.showNotification(title, {
      body: data.body || 'Você tem um novo pedido de agendamento.',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || 'pedido',
      renotify: true,
      data: { url: data.url || '/admin' },
    }),
    // avisa o painel aberto para atualizar a lista
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: 'refresh' }))),
  ];
  // número no ícone do app (iPhone com o painel na Tela de Início, Android, computador)
  if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
    tasks.push((data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/admin', self.location.origin).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const admin = list.find((c) => new URL(c.url).pathname.startsWith('/admin'));
    if (admin) {
      await admin.focus();
      admin.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
