// Quick log of all session cookies
const all = document.cookie
console.log('all cookies:', all)
// Test WS connection status
import('y-websocket').then((m) => {
  const { WebsocketProvider } = m
  const ws = new WebsocketProvider('ws://localhost:3000/api/collab/test?uid=test', 'test', new (require('yjs')).Doc())
  ws.on('status', (e) => console.log('ws status:', e.status))
  ws.on('connection-error', (e) => console.log('ws err:', e))
  setTimeout(() => { ws.destroy() }, 2000)
})
