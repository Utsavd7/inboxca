// InboxCA's phone notifications (PLAN.md 5.17.2): show what the server sent, and open the
// page it names when tapped. The message never names a client.
self.addEventListener("push", (event) => {
  const message = event.data ? event.data.json() : { title: "InboxCA", body: "", url: "/app" };
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, data: message.url, icon: "/icon.svg" }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data || "/app"));
});
