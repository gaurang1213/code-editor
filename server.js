const { createServer } = require('http');
const next = require('next');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
// Accept any Host header and allow access from other machines
const hostname = undefined; // or '0.0.0.0'
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handler(req, res));

  // ---- Raw WebSocket implementation (no socket.io) ----
  const WEBSOCKET_MAGIC_STRING_KEY = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const SEVEN_BITS_INTEGER_MARKER = 125;
  const SIXTEEN_BITS_INTEGER_MARKER = 126;
  const MAXIMUM_SIXTEEN_BITS_INTEGER = 2 ** 16;
  const MASK_KEY_BYTES_LENGTH = 4;
  const OPCODE_TEXT = 0x01;
  const FIRST_BIT = 128;

  // Rooms state
  // roomId -> [{ socketId, username, socket }]
  const roomClients = {};
  // socketId -> username
  const userSocketMap = {};
  // roomId -> { fileId: content }
  const roomFiles = {};

  // ---- Simple disk persistence for room snapshots ----
  const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || path.join(process.cwd(), 'collab-snapshots');
  function ensureDir() {
    try { fs.mkdirSync(SNAPSHOT_DIR, { recursive: true }); } catch (_) {}
  }
  function snapshotPath(roomId) {
    return path.join(SNAPSHOT_DIR, `${roomId}.json`);
  }
  function loadRoomSnapshot(roomId) {
    ensureDir();
    try {
      const p = snapshotPath(roomId);
      if (fs.existsSync(p)) {
        const json = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(json || '{}');
        if (data && typeof data === 'object') {
          roomFiles[roomId] = data;
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function saveRoomSnapshot(roomId) {
    ensureDir();
    try {
      const p = snapshotPath(roomId);
      fs.writeFileSync(p, JSON.stringify(roomFiles[roomId] || {}, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  }

  const RAW_ACTIONS = {
    JOIN: 'join',
    JOINED: 'joined',
    JOINED_SELF: 'joined-self',
    DISCONNECTED: 'disconnected',
    CONTENT_CHANGE: 'content-change',
    SAVED: 'saved',
    FILE_OP: 'file-op',
    SYNC_FILES: 'sync-files',
    LEAVE: 'leave',
    REQUEST_FILE: 'request-file',
  };

  function getClientBySocketId(socketId) {
    for (const roomId in roomClients) {
      const client = roomClients[roomId].find(c => c.socketId === socketId);
      if (client) return { client, roomId };
    }
    return null;
  }

  function getAllClientsInRoom(roomId) {
    return roomClients[roomId]?.map(({ socketId, username }) => ({ socketId, username })) || [];
  }

  function concat(bufferList, totalLength) {
    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (const buffer of bufferList) {
      target.set(buffer, offset);
      offset += buffer.length;
    }
    return target;
  }

  function prepareMessage(message) {
    const msg = Buffer.from(message);
    const messageSize = msg.length;
    let dataFrameBuffer;
    const firstByte = 0x80 | OPCODE_TEXT; // FIN + text
    if (messageSize <= SEVEN_BITS_INTEGER_MARKER) {
      const bytes = [firstByte];
      dataFrameBuffer = Buffer.from(bytes.concat(messageSize));
    } else if (messageSize <= MAXIMUM_SIXTEEN_BITS_INTEGER) {
      const target = Buffer.allocUnsafe(4);
      target[0] = firstByte;
      target[1] = SIXTEEN_BITS_INTEGER_MARKER | 0x0; // server messages unmasked
      target.writeUint16BE(messageSize, 2);
      dataFrameBuffer = target;
    } else {
      throw new Error('message too long');
    }
    const totalLength = dataFrameBuffer.byteLength + messageSize;
    return concat([dataFrameBuffer, msg], totalLength);
  }

  function sendMessage(msg, socket) {
    const data = prepareMessage(msg);
    if (socket.writable) socket.write(data);
  }

  function broadcastMessage(roomId, message, excludeSocketId) {
    const clients = roomClients[roomId];
    if (!clients) return;
    const data = prepareMessage(message);
    clients.forEach(({ socketId, socket }) => {
      if (excludeSocketId && socketId === excludeSocketId) return;
      if (socket.writable) socket.write(data);
    });
  }

  function createSocketAccept(id) {
    const sha1 = crypto.createHash('sha1');
    sha1.update(id + WEBSOCKET_MAGIC_STRING_KEY);
    return sha1.digest('base64');
  }

  function prepareHandShakeHeaders(id) {
    const acceptKey = createSocketAccept(id);
    return [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
    ]
      .map((line) => line.concat('\r\n'))
      .join('');
  }

  function unmask(encodedBuffer, maskKey) {
    const finalBuffer = Buffer.from(encodedBuffer);
    for (let i = 0; i < encodedBuffer.length; i++) {
      finalBuffer[i] = encodedBuffer[i] ^ maskKey[i % MASK_KEY_BYTES_LENGTH];
    }
    return finalBuffer;
  }

  function handleWebSocketMessage(socket, decodedMessage) {
    try {
      const { action, payload } = JSON.parse(decodedMessage);
      const { roomId, username, fileId, content, type, ...rest } = payload || {};

      const senderInfo = getClientBySocketId(socket._socketId);
      const senderRoomId = senderInfo?.roomId || roomId;
      const senderUsername = userSocketMap[socket._socketId];

      if (action === RAW_ACTIONS.JOIN && senderRoomId) {
        const client = { socketId: socket._socketId, username, socket };
        userSocketMap[client.socketId] = username;
        if (!roomClients[senderRoomId]) roomClients[senderRoomId] = [];
        // Remove any stale entries with the same socketId before adding
        roomClients[senderRoomId] = roomClients[senderRoomId].filter(c => c.socketId !== client.socketId);
        roomClients[senderRoomId].push(client);
        if (!roomFiles[senderRoomId]) {
          // Try to hydrate from disk; otherwise initialize
          if (!loadRoomSnapshot(senderRoomId)) {
            roomFiles[senderRoomId] = {};
          }
        }

        const clients = getAllClientsInRoom(senderRoomId);
        const joinMessage = JSON.stringify({
          action: RAW_ACTIONS.JOINED,
          payload: { clients, username, socketId: client.socketId, ts: Date.now() },
        });
        broadcastMessage(senderRoomId, joinMessage);

        // Also notify the joining client explicitly so it can mark itself joined early
        const joinSelfMessage = JSON.stringify({
          action: RAW_ACTIONS.JOINED_SELF,
          payload: { clients, username, socketId: client.socketId, ts: Date.now() },
        });
        sendMessage(joinSelfMessage, client.socket);

        // Send current files snapshot to the new client
        const syncMessage = JSON.stringify({
          action: RAW_ACTIONS.SYNC_FILES,
          payload: { files: roomFiles[senderRoomId], ts: Date.now() },
        });
        sendMessage(syncMessage, client.socket);
        return;
      }

      if (action === RAW_ACTIONS.REQUEST_FILE && senderRoomId && fileId) {
        const files = roomFiles[senderRoomId] || {};
        const latest = files[fileId] || '';
        // Send only to requester as a normal content-change so clients can reuse handler
        const contentMsg = JSON.stringify({
          action: RAW_ACTIONS.CONTENT_CHANGE,
          payload: { fileId, content: latest, ts: Date.now() },
        });
        sendMessage(contentMsg, socket);
        return;
      }

      if (action === RAW_ACTIONS.LEAVE) {
        // Explicit leave request: cleanup and broadcast
        try { socket.destroy(); } catch(_){ }
        onSocketClose(socket._socketId);
        return;
      }

      if (action === RAW_ACTIONS.CONTENT_CHANGE && senderRoomId && fileId) {
        if (!roomFiles[senderRoomId]) roomFiles[senderRoomId] = {};
        roomFiles[senderRoomId][fileId] = content || '';
        saveRoomSnapshot(senderRoomId);
        const changeMessage = JSON.stringify({
          action: RAW_ACTIONS.CONTENT_CHANGE,
          payload: { fileId, content, ts: (payload && payload.ts) || Date.now() },
        });
        broadcastMessage(senderRoomId, changeMessage, socket._socketId);
        return;
      }

      if (action === RAW_ACTIONS.SAVED && senderRoomId && fileId) {
        if (!roomFiles[senderRoomId]) roomFiles[senderRoomId] = {};
        roomFiles[senderRoomId][fileId] = content || '';
        saveRoomSnapshot(senderRoomId);
        const savedMessage = JSON.stringify({
          action: RAW_ACTIONS.SAVED,
          payload: { fileId, content, ts: (payload && payload.ts) || Date.now() },
        });
        broadcastMessage(senderRoomId, savedMessage, socket._socketId);
        return;
      }


      if (action === RAW_ACTIONS.FILE_OP && senderRoomId) {
        // Preserve original payload fields (except roomId) to avoid dropping data needed by clients
        const { roomId: _omit, ...forward } = payload || {};
        const fileOpMessage = JSON.stringify({
          action: RAW_ACTIONS.FILE_OP,
          payload: { ...forward, ts: (payload && payload.ts) || Date.now() },
        });
        broadcastMessage(senderRoomId, fileOpMessage, socket._socketId);
        return;
      }
    } catch (e) {
      console.error('Error processing WebSocket message:', e);
    }
  }

  function onSocketReadable(socket) {
    while (true) {
      // Read 1st byte (FIN + opcode)
      const b1 = socket.read(1);
      if (!b1) return;
      const byte1 = b1[0];
      const fin = (byte1 & 0x80) === 0x80;
      const opcode = byte1 & 0x0f; // 0x1 = text, 0x0 = continuation, 0x8 = close, 0x9 = ping, 0xA = pong

      // Read 2nd byte (MASK bit + payload len)
      const b2 = socket.read(1);
      if (!b2) return;
      const byte2 = b2[0];
      const masked = (byte2 & 0x80) === 0x80;
      let payloadLen = byte2 & 0x7f;

      if (!masked) {
        return;
      }

      if (payloadLen === 126) {
        const ext = socket.read(2);
        if (!ext) return;
        payloadLen = ext.readUInt16BE(0);
      } else if (payloadLen === 127) {
        const ext = socket.read(8);
        if (!ext) return;
        console.error(`Unsupported 64-bit payload from ${socket._socketId}`);
        return;
      }

      const maskKey = socket.read(MASK_KEY_BYTES_LENGTH);
      const encoded = socket.read(payloadLen);
      if (!maskKey || !encoded) return;

      if (opcode === 0x8) {
        try { socket.destroy(); } catch(_) {}
        onSocketClose(socket._socketId);
        return;
      }
      if (opcode === 0x9 || opcode === 0xA) {
        continue; // ignore ping/pong
      }

      const decodedBuffer = unmask(encoded, maskKey);

      if (opcode === OPCODE_TEXT) {
        if (fin) {
          handleWebSocketMessage(socket, decodedBuffer.toString('utf8'));
        } else {
          socket._frag = decodedBuffer;
        }
        continue;
      }

      if (opcode === 0x0) { // continuation
        if (!socket._frag) {
          continue;
        }
        socket._frag = Buffer.concat([socket._frag, decodedBuffer]);
        if (fin) {
          const msg = socket._frag.toString('utf8');
          socket._frag = null;
          handleWebSocketMessage(socket, msg);
        }
        continue;
      }
    }
  }

  function onSocketClose(socketId) {
    const senderInfo = getClientBySocketId(socketId);
    if (!senderInfo) return;
    const { roomId } = senderInfo;
    const username = userSocketMap[socketId];
    if (roomClients[roomId]) {
      roomClients[roomId] = roomClients[roomId].filter((c) => c.socketId !== socketId);
    }
    delete userSocketMap[socketId];
    const disconnectMessage = JSON.stringify({
      action: RAW_ACTIONS.DISCONNECTED,
      payload: { socketId, username },
    });
    broadcastMessage(roomId, disconnectMessage);
    if (roomClients[roomId].length === 0) {
      // Preserve roomFiles so the next join gets the latest snapshot
      delete roomClients[roomId];
      // Intentionally NOT deleting roomFiles[roomId]
    }
  }

  function onSocketUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    const upgradeHeader = (req.headers['upgrade'] || '').toString().toLowerCase();
    if (!key || upgradeHeader !== 'websocket') {
      try { socket.destroy(); } catch (_) {}
      return;
    }
    socket._socketId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const headers = prepareHandShakeHeaders(key);
    socket.write(headers);
    socket.on('readable', () => onSocketReadable(socket));
    socket.on('close', () => onSocketClose(socket._socketId));
    socket.on('error', () => onSocketClose(socket._socketId));
    // log
    // console.log(`Client ${socket._socketId} connected via raw WebSocket.`);
  }

  httpServer.on('upgrade', (req, socket) => {
    // Only accept upgrades on /ws to avoid catching Next.js HMR/event sockets
    if (req.url === '/ws') return onSocketUpgrade(req, socket);
    try { socket.destroy(); } catch (_) {}
  });

  // Global error guards
  ['uncaughtException', 'unhandledRejection'].forEach((event) =>
    process.on(event, (err) => {
      console.error(`Unhandled ${event}:`, err && err.stack ? err.stack : err);
    })
  );

  httpServer.listen(port, '0.0.0.0', (err) => {
    if (err) throw err;
    console.log(`> Ready on http://0.0.0.0:${port}`);
  });
});
