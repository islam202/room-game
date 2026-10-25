import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

const port = Number(process.env.PORT || 3001);
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(appDirectory, '..', 'dist');
const app = express();
const configuredOrigins = process.env.MATCHMAKING_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [
  ...(configuredOrigins || []),
  process.env.RENDER_EXTERNAL_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);
app.use(express.static(frontendDirectory));
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.use((request, response, next) => {
  if (request.method !== 'GET' || request.path.startsWith('/socket.io/')) {
    next();
    return;
  }
  response.sendFile(path.join(frontendDirectory, 'index.html'));
});
app.use((_request, response) => response.sendStatus(404));
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      const isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production'
        && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
      if (!origin || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by the matchmaking server.'));
    },
    methods: ['GET', 'POST'],
  },
});
const waitingPlayers = [];
const matches = new Map();

function removeFromQueue(socketId) {
  const index = waitingPlayers.findIndex((player) => player.socket.id === socketId);
  if (index < 0) return false;
  waitingPlayers.splice(index, 1);
  return true;
}

function endMatch(matchId, disconnectedSocketId) {
  const match = matches.get(matchId);
  if (!match) return;
  matches.delete(matchId);
  const otherPlayer = match.players.find((player) => player.socket.id !== disconnectedSocketId);
  match.players.forEach((player) => {
    player.socket.data.matchId = null;
    player.socket.data.matchRole = null;
  });
  otherPlayer?.socket.emit('matchmaking:peer-left');
}

io.on('connection', (socket) => {
  socket.on('matchmaking:join', (payload, acknowledge) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim().slice(0, 12) : '';
    if (!name) {
      acknowledge?.({ ok: false, error: 'اكتب اسمك الأول، لحد ١٢ حرف.' });
      return;
    }
    if (socket.data.matchId || waitingPlayers.some((player) => player.socket.id === socket.id)) {
      acknowledge?.({ ok: false, error: 'إنت بالفعل في طابور المطابقة.' });
      return;
    }
    if (waitingPlayers.length >= 100) {
      acknowledge?.({ ok: false, error: 'الطابور مشغول دلوقتي. جرّب بعد شوية.' });
      return;
    }

    const waitingPlayer = waitingPlayers.shift();
    if (!waitingPlayer) {
      waitingPlayers.push({ socket, name });
      acknowledge?.({ ok: true, status: 'waiting' });
      return;
    }

    const matchId = randomUUID();
    const peerId = `khotafha-r-${randomUUID()}`;
    const players = [
      waitingPlayer,
      { socket, name },
    ];
    const match = { players, peerId };
    matches.set(matchId, match);
    players.forEach((player, index) => {
      player.socket.data.matchId = matchId;
      player.socket.data.matchRole = index === 0 ? 'host' : 'guest';
      player.socket.emit('matchmaking:matched', {
        matchId,
        role: player.socket.data.matchRole,
        peerId,
        opponentName: players[index === 0 ? 1 : 0].name,
      });
    });
    acknowledge?.({ ok: true, status: 'paired' });
  });

  socket.on('matchmaking:cancel', () => {
    if (removeFromQueue(socket.id)) return;
    if (socket.data.matchId) {
      const matchId = socket.data.matchId;
      socket.data.matchId = null;
      endMatch(matchId, socket.id);
    }
  });

  socket.on('matchmaking:host-ready', () => {
    const match = matches.get(socket.data.matchId);
    if (!match || socket.data.matchRole !== 'host') return;
    const guest = match.players[1];
    guest.socket.emit('matchmaking:host-ready', { peerId: match.peerId });
  });

  socket.on('matchmaking:peer-connected', () => {
    const matchId = socket.data.matchId;
    if (!matchId || socket.data.matchRole !== 'guest' || !matches.has(matchId)) return;
    matches.delete(matchId);
    matchPlayersClear(matchId);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    if (socket.data.matchId) endMatch(socket.data.matchId, socket.id);
  });
});

function matchPlayersClear(matchId) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.matchId === matchId) {
      socket.data.matchId = null;
      socket.data.matchRole = null;
    }
  }
}

httpServer.listen(port, () => {
  console.log(`Matchmaking server listening on port ${port}`);
});
