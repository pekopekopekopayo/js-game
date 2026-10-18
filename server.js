const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { WebSocket, WebSocketServer } = require('ws');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const botLevels = {
  beginner: { label: '초급 BOT', reaction: 720, accuracy: 0.42, cooldown: 1350, range: 330, speed: 2.8, dodge: 0 },
  intermediate: { label: '중급 BOT', reaction: 360, accuracy: 0.2, cooldown: 820, range: 270, speed: 3.5, dodge: 120 },
  advanced: { label: '고급 BOT', reaction: 170, accuracy: 0.06, cooldown: 470, range: 210, speed: 4.1, dodge: 175 },
};
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(root, requested);

  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(contents);
  });
});

const sockets = new WebSocketServer({ server });

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const player of room.players) send(player.socket, message);
}

function combatants(room) {
  return room.bot ? [...room.players, room.bot] : room.players;
}

function roomSnapshot(room) {
  return {
    type: 'room',
    code: room.code,
    status: room.status,
    timeLeft: room.timeLeft,
    players: combatants(room).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      score: player.score,
      ready: player.ready,
      isBot: Boolean(player.isBot),
    })),
  };
}

function updateRoom(room) {
  broadcast(room, roomSnapshot(room));
}

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function leaveRoom(player) {
  const room = player.room;
  if (!room) return;
  player.room = null;
  room.players = room.players.filter((entry) => entry !== player);

  if (room.status === 'playing' && room.players.length) {
    clearInterval(room.timer);
    room.status = 'finished';
    room.winner = room.players[0].id;
    room.players.forEach((entry) => { entry.ready = false; });
    broadcast(room, { type: 'gameOver', winner: room.winner, reason: 'opponent-left' });
  }

  if (room.players.length === 0) {
    clearInterval(room.timer);
    rooms.delete(room.code);
  } else {
    updateRoom(room);
  }
}

function finishGame(room, winner, reason = 'score') {
  if (room.status !== 'playing') return;
  clearInterval(room.timer);
  room.status = 'finished';
  room.winner = winner;
  combatants(room).forEach((player) => { player.ready = false; });
  broadcast(room, { type: 'gameOver', winner, reason });
  updateRoom(room);
}

function startGame(room) {
  const canStart = room.bot
    ? room.players.length === 1 && room.players[0].ready
    : room.players.length === 2 && room.players.every((player) => player.ready);
  if (!canStart) return;
  clearInterval(room.timer);
  room.status = 'playing';
  room.timeLeft = 120;
  room.bullets = [];
  combatants(room).forEach((player, index) => {
    player.x = index === 0 ? 130 : 830;
    player.y = 300;
    player.score = 0;
    player.input = { up: false, down: false, left: false, right: false, angle: index === 0 ? 0 : Math.PI };
    player.lastShot = 0;
    player.nextShotAt = 0;
    player.nextThinkAt = 0;
    if (player.isBot) {
      player.ready = true;
      player.orbitDirection = player.orbitDirection || (Math.random() < 0.5 ? -1 : 1);
    }
  });
  broadcast(room, { type: 'gameStarted' });
  updateRoom(room);

  room.timer = setInterval(() => {
    if (room.status !== 'playing') return;
    room.timeLeft -= 1;
    if (room.timeLeft <= 0) {
      const [first, second] = combatants(room);
      const winner = first.score === second.score ? null : first.score > second.score ? first.id : second.id;
      finishGame(room, winner, 'time');
    }
  }, 1000);
}

function thinkForBot(room, bot, target, now) {
  const profile = botLevels[room.difficulty];
  if (now < bot.nextThinkAt) return;
  bot.nextThinkAt = now + profile.reaction;

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const distance = Math.hypot(dx, dy) || 1;
  let moveX = 0;
  let moveY = 0;
  if (distance > profile.range + 24) {
    moveX = dx / distance;
    moveY = dy / distance;
  } else if (distance < profile.range - 34) {
    moveX = -dx / distance;
    moveY = -dy / distance;
  } else {
    const direction = bot.orbitDirection;
    moveX = (-dy / distance) * direction;
    moveY = (dx / distance) * direction;
  }

  if (profile.dodge) {
    const threat = room.bullets.find((bullet) => {
      if (bullet.owner !== target.id) return false;
      const bx = bot.x - bullet.x;
      const by = bot.y - bullet.y;
      const close = Math.hypot(bx, by) < profile.dodge;
      const approaching = Math.cos(bullet.angle) * bx + Math.sin(bullet.angle) * by > 0;
      return close && approaching;
    });
    if (threat) {
      const awayX = bot.x - threat.x;
      const awayY = bot.y - threat.y;
      const awayLength = Math.hypot(awayX, awayY) || 1;
      moveX += (awayX / awayLength) * 1.5;
      moveY += (awayY / awayLength) * 1.5;
    }
  }

  bot.input = {
    up: moveY < -0.2,
    down: moveY > 0.2,
    left: moveX < -0.2,
    right: moveX > 0.2,
    angle: Math.atan2(dy, dx) + (Math.random() - 0.5) * profile.accuracy,
  };
}

function fireBullet(room, player) {
  room.bullets.push({
    id: Math.random().toString(36).slice(2, 9),
    owner: player.id,
    x: player.x + Math.cos(player.input.angle) * 26,
    y: player.y + Math.sin(player.input.angle) * 26,
    angle: player.input.angle,
    remove: false,
  });
}

function gameTick() {
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;

    const players = combatants(room);
    if (room.bot && room.players[0]) thinkForBot(room, room.bot, room.players[0], Date.now());

    for (const player of players) {
      const input = player.input;
      const dx = Number(input.right) - Number(input.left);
      const dy = Number(input.down) - Number(input.up);
      const length = Math.hypot(dx, dy) || 1;
      const speed = player.isBot ? botLevels[room.difficulty].speed : 4.3;
      player.x = Math.max(28, Math.min(932, player.x + (dx / length) * speed));
      player.y = Math.max(28, Math.min(572, player.y + (dy / length) * speed));
      if (player.isBot && Date.now() >= player.nextShotAt) {
        fireBullet(room, player);
        player.nextShotAt = Date.now() + botLevels[room.difficulty].cooldown;
      }
    }

    for (const bullet of room.bullets) {
      bullet.x += Math.cos(bullet.angle) * 10;
      bullet.y += Math.sin(bullet.angle) * 10;
      const target = players.find((player) => player.id !== bullet.owner);
      if (target && Math.hypot(target.x - bullet.x, target.y - bullet.y) < 25) {
        const shooter = players.find((player) => player.id === bullet.owner);
        if (shooter) shooter.score += 1;
        bullet.remove = true;
        if (shooter) broadcast(room, { type: 'hit', shooter: shooter.id, target: target.id, score: shooter.score });
        if (shooter && shooter.score >= 5) finishGame(room, shooter.id);
      }
      if (bullet.x < 0 || bullet.x > 960 || bullet.y < 0 || bullet.y > 600) bullet.remove = true;
    }
    room.bullets = room.bullets.filter((bullet) => !bullet.remove);
    broadcast(room, {
      type: 'state',
      timeLeft: room.timeLeft,
      players: players.map(({ id, x, y, score, input }) => ({ id, x, y, score, angle: input.angle })),
      bullets: room.bullets.map(({ id, owner, x, y }) => ({ id, owner, x, y })),
    });
  }
}

setInterval(gameTick, 1000 / 30);

sockets.on('connection', (socket) => {
  const player = {
    id: Math.random().toString(36).slice(2, 10),
    socket,
    name: 'Player',
    color: '#65f6d0',
    ready: false,
    x: 130,
    y: 300,
    score: 0,
    input: { up: false, down: false, left: false, right: false, angle: 0 },
    lastShot: 0,
    room: null,
  };

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'createRoom') {
      if (player.room) leaveRoom(player);
      const code = makeCode();
      const room = { code, status: 'waiting', mode: 'pvp', difficulty: null, bot: null, players: [], bullets: [], timeLeft: 120, timer: null };
      room.players.push(player);
      player.room = room;
      player.name = String(message.name || 'Player').trim().slice(0, 16) || 'Player';
      player.color = '#65f6d0';
      rooms.set(code, room);
      send(socket, { type: 'joined', id: player.id, code });
      updateRoom(room);
      return;
    }

    if (message.type === 'createBot') {
      if (player.room) leaveRoom(player);
      const difficulty = Object.hasOwn(botLevels, message.difficulty) ? message.difficulty : 'beginner';
      const code = makeCode();
      const room = { code, status: 'waiting', mode: 'bot', difficulty, players: [], bullets: [], timeLeft: 120, timer: null };
      player.room = room;
      player.name = String(message.name || 'Pilot').trim().slice(0, 16) || 'Pilot';
      player.color = '#65f6d0';
      player.ready = true;
      room.players.push(player);
      room.bot = {
        id: `bot-${code}`,
        name: botLevels[difficulty].label,
        color: '#ff718e',
        score: 0,
        ready: true,
        isBot: true,
        orbitDirection: Math.random() < 0.5 ? -1 : 1,
        input: { up: false, down: false, left: false, right: false, angle: Math.PI },
      };
      rooms.set(code, room);
      send(socket, { type: 'joined', id: player.id, code });
      updateRoom(room);
      startGame(room);
      return;
    }

    if (message.type === 'joinRoom') {
      const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return send(socket, { type: 'error', message: '방 코드를 찾을 수 없습니다.' });
      if (room.players.length >= 2 || room.status !== 'waiting') return send(socket, { type: 'error', message: '이 방은 이미 가득 찼습니다.' });
      if (player.room) leaveRoom(player);
      player.room = room;
      player.name = String(message.name || 'Player').trim().slice(0, 16) || 'Player';
      player.color = '#ff718e';
      room.players.push(player);
      send(socket, { type: 'joined', id: player.id, code });
      updateRoom(room);
      return;
    }

    const room = player.room;
    if (!room) return;

    if (message.type === 'ready' && room.status === 'waiting') {
      player.ready = Boolean(message.ready);
      updateRoom(room);
      startGame(room);
    } else if (message.type === 'input' && room.status === 'playing') {
      const input = message.input || {};
      player.input = {
        up: Boolean(input.up),
        down: Boolean(input.down),
        left: Boolean(input.left),
        right: Boolean(input.right),
        angle: Number.isFinite(input.angle) ? input.angle : player.input.angle,
      };
      if (input.shoot && Date.now() - player.lastShot > 280) {
        player.lastShot = Date.now();
        fireBullet(room, player);
      }
    } else if (message.type === 'playAgain' && room.status === 'finished') {
      player.ready = true;
      if (room.players.length === 2) room.players.forEach((entry) => { entry.ready = true; });
      if (room.bot) room.bot.ready = true;
      startGame(room);
    } else if (message.type === 'leaveRoom') {
      leaveRoom(player);
      send(socket, { type: 'leftRoom' });
    }
  });

  socket.on('close', () => leaveRoom(player));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Neon Duel running on http://0.0.0.0:${port}`);
});
