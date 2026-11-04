// Service worker mínimo de VOLT: habilita la instalación como app.
// No guarda nada en caché ni simula modo sin conexión: todo pasa directo a la red.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
