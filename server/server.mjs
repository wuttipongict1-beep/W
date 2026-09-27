import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';

const directory = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpPort = Number(process.env.PHONEOBS_HTTP_PORT || 8888);
const httpsPort = Number(process.env.PHONEOBS_HTTPS_PORT || 8443);
const hostAddress = process.env.PHONEOBS_HOST || findLanAddress();
const slotTokens = Array.from({ length: 4 }, () => randomBytes(18).toString('hex'));
const rooms = Array.from({ length: 4 }, () => new Map());

app.use(express.static(path.join(directory, 'public')));
app.get('/phone/:slot', (request, response) => {
  response.sendFile(path.join(directory, 'public', 'camera.html'));
});
app.get('/view/:slot', (request, response) => {
  response.sendFile(path.join(directory, 'public', 'camera.html'));
});
app.get('/api/slots', async (_request, response) => {
  if (!isLoopback(_request.socket.remoteAddress)) {
    response.status(403).json({ error: 'Pairing codes are available only on the PC.' });
    return;
  }
  if (!tlsAvailable) {
    response.status(503).json({ error: 'Configure a trusted HTTPS certificate before pairing phones.' });
    return;
  }

  const slots = await Promise.all(slotTokens.map(async (token, index) => {
    const slot = index + 1;
    const url = `https://${hostAddress}:${httpsPort}/phone/${slot}?token=${token}`;
    return { slot, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 192 }) };
  }));
  response.json({ slots, host: hostAddress, httpsPort });
});

const httpServer = createHttpServer(app);
const httpSockets = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (request, socket, head) => {
  if (!isLoopback(request.socket.remoteAddress)) {
    socket.destroy();
    return;
  }
  httpSockets.handleUpgrade(request, socket, head, (webSocket) => attachClient(webSocket, request));
});

const certificatePath = process.env.PHONEOBS_TLS_CERT;
const privateKeyPath = process.env.PHONEOBS_TLS_KEY;
const tlsAvailable = Boolean(certificatePath && privateKeyPath);
let httpsServer;
if (tlsAvailable) {
  httpsServer = createHttpsServer({
    cert: readFileSync(certificatePath),
    key: readFileSync(privateKeyPath),
  }, app);
  const secureSockets = new WebSocketServer({ noServer: true });
  httpsServer.on('upgrade', (request, socket, head) => {
    secureSockets.handleUpgrade(request, socket, head, (webSocket) => attachClient(webSocket, request));
  });
}

function findLanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal)
        return address.address;
    }
  }
  return '127.0.0.1';
}

function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');
}

function sendJson(webSocket, message) {
  if (webSocket?.readyState === WebSocket.OPEN)
    webSocket.send(JSON.stringify(message));
}

function attachClient(webSocket, request) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const slot = Number(requestUrl.searchParams.get('slot'));
  const role = requestUrl.searchParams.get('role');
  const token = requestUrl.searchParams.get('token');
  const isPhone = role === 'phone';
  const isReceiver = role === 'receiver';

  if (!Number.isInteger(slot) || slot < 1 || slot > 4 || (!isPhone && !isReceiver)) {
    webSocket.close(1008, 'Invalid slot or role');
    return;
  }
  if (isPhone && (!request.socket.encrypted || token !== slotTokens[slot - 1])) {
    webSocket.close(1008, 'Invalid pairing token or insecure connection');
    return;
  }
  if (isReceiver && !isLoopback(request.socket.remoteAddress)) {
    webSocket.close(1008, 'Receiver must connect locally');
    return;
  }

  const room = rooms[slot - 1];
  const roleKey = isPhone ? 'phone' : 'receiver';
  const previous = room.get(roleKey);
  if (previous && previous !== webSocket)
    previous.close(4000, 'Replaced by a new connection');
  room.set(roleKey, webSocket);
  webSocket.phoneobsSlot = slot;
  webSocket.phoneobsRole = roleKey;
  sendJson(webSocket, { type: 'connected', slot });
  const peer = room.get(roleKey === 'phone' ? 'receiver' : 'phone');
  if (peer) {
    sendJson(webSocket, { type: 'peer-ready' });
    sendJson(peer, { type: 'peer-ready' });
  }

  webSocket.on('message', (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      sendJson(webSocket, { type: 'error', message: 'Invalid signaling message.' });
      return;
    }

    if (!['offer', 'answer', 'candidate'].includes(message.type))
      return;
    const destination = room.get(roleKey === 'phone' ? 'receiver' : 'phone');
    if (destination)
      sendJson(destination, { type: message.type, payload: message.payload });
  });

  webSocket.on('close', () => {
    if (room.get(roleKey) === webSocket)
      room.delete(roleKey);
    const peer = room.get(roleKey === 'phone' ? 'receiver' : 'phone');
    sendJson(peer, { type: 'peer-left' });
  });
}

httpServer.listen(httpPort, '127.0.0.1', () => {
  console.log(`PhoneOBS dashboard and receiver: http://127.0.0.1:${httpPort}`);
});
if (httpsServer) {
  httpsServer.listen(httpsPort, '0.0.0.0', () => {
    console.log(`Phone pairing: https://${hostAddress}:${httpsPort}`);
  });
} else {
  console.warn('Phone pairing is disabled: set PHONEOBS_TLS_CERT and PHONEOBS_TLS_KEY to enable HTTPS/WSS.');
}
