const lobbyView = document.querySelector('#lobby-view');
const roomView = document.querySelector('#room-view');
const connectionLabel = document.querySelector('#connection-label');
const createName = document.querySelector('#create-name');
const joinName = document.querySelector('#join-name');
const joinCode = document.querySelector('#join-code');
const roomCode = document.querySelector('#room-code');
const overlayCode = document.querySelector('#overlay-code');
const waitingOverlay = document.querySelector('#waiting-overlay');
const waitingTitle = document.querySelector('#waiting-title');
const waitingCopy = document.querySelector('#waiting-copy');
const countdownOverlay = document.querySelector('#countdown-overlay');
const gameOverOverlay = document.querySelector('#game-over-overlay');
const readyButton = document.querySelector('#ready-button');
const readyLabel = document.querySelector('#ready-label');
const playerList = document.querySelector('#player-list');
const playerCount = document.querySelector('#player-count');
const roomMessage = document.querySelector('#room-message');
const arenaStatus = document.querySelector('#arena-status');
const timerLabel = document.querySelector('#timer');
const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');
const fighterImage = new Image();
fighterImage.src = '/ai-images/neon-fighter.png';
const toast = document.querySelector('#toast');

let socket;
let myId = null;
let currentRoom = null;
let roomState = null;
let gameState = { players: [], bullets: [], timeLeft: 120 };
let gameStarted = false;
let ready = false;
let botDifficulty = 'beginner';
let aimAngle = 0;
let toastTimer;
let countdownTimer;
let shakeUntil = 0;
const keys = new Set();
const pointer = { shooting: false };
const impactEffects = [];
const obstacles = [
  { x: 278, y: 150, w: 68, h: 20 }, { x: 614, y: 430, w: 68, h: 20 },
  { x: 450, y: 80, w: 60, h: 15 }, { x: 450, y: 505, w: 60, h: 15 },
];

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);
  connectionLabel.textContent = '서버 연결 중';
  socket.addEventListener('open', () => {
    connectionLabel.textContent = '실시간 서버 연결됨';
    document.querySelector('.topbar-center .live-dot').style.background = 'var(--mint)';
  });
  socket.addEventListener('close', () => {
    connectionLabel.textContent = '서버 연결 끊김';
    document.querySelector('.topbar-center .live-dot').style.background = 'var(--pink)';
    if (currentRoom) showToast('서버 연결이 끊겼습니다. 새로고침해 주세요.');
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleMessage(message);
  });
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function handleMessage(message) {
  if (message.type === 'error') {
    showToast(message.message);
    return;
  }
  if (message.type === 'joined') {
    myId = message.id;
    currentRoom = message.code;
    lobbyView.classList.add('hidden');
    roomView.classList.remove('hidden');
    roomCode.textContent = message.code;
    overlayCode.textContent = message.code;
    waitingOverlay.classList.remove('hidden');
    gameOverOverlay.classList.add('hidden');
    ready = false;
    gameStarted = false;
    aimAngle = 0;
    document.querySelector('#room-title').textContent = '대기실';
    send({ type: 'requestRoom' });
  } else if (message.type === 'leftRoom') {
    currentRoom = null;
    myId = null;
    roomView.classList.add('hidden');
    lobbyView.classList.remove('hidden');
  } else if (message.type === 'room') {
    roomState = message;
    updateRoomUi();
  } else if (message.type === 'gameStarted') {
    startCountdown();
  } else if (message.type === 'state') {
    gameState = message;
    timerLabel.textContent = formatTime(message.timeLeft);
    for (const player of message.players) {
      const score = document.querySelector(`[data-player-id="${CSS.escape(player.id)}"] .player-score`);
      if (score) score.textContent = `${player.score} PTS`;
    }
    if (message.timeLeft <= 0) gameStarted = false;
  } else if (message.type === 'hit') {
    const target = gameState.players.find((player) => player.id === message.target);
    if (target) {
      const color = roomState?.players.find((player) => player.id === message.target)?.color || '#ff718e';
      impactEffects.push({
        x: target.x,
        y: target.y,
        color,
        createdAt: performance.now(),
        sparks: Array.from({ length: 12 }, () => ({ angle: Math.random() * Math.PI * 2, distance: 22 + Math.random() * 30, length: 4 + Math.random() * 8 })),
      });
    }
    if (message.target === myId) shakeUntil = performance.now() + 180;
    if (message.target === myId) showToast('피격! 상대가 점수를 얻었습니다.');
    else if (message.shooter === myId) showToast('명중! 점수를 얻었습니다.');
  } else if (message.type === 'gameOver') {
    gameStarted = false;
    ready = false;
    clearInterval(countdownTimer);
    countdownOverlay.classList.add('hidden');
    waitingOverlay.classList.add('hidden');
    gameOverOverlay.classList.remove('hidden');
    const winner = roomState?.players.find((player) => player.id === message.winner);
    const tied = !message.winner;
    const didWin = message.winner === myId;
    document.querySelector('#result-title').textContent = tied ? '무승부!' : didWin ? '승리!' : '아쉬워요!';
    document.querySelector('#result-copy').textContent = message.reason === 'opponent-left'
      ? '상대 플레이어가 나가 경기가 종료됐어요.'
      : tied ? '두 플레이어의 점수가 같아요.' : `${winner?.name || '상대'}와 멋진 경기를 했어요.`;
    document.querySelector('#play-again').classList.toggle('hidden', message.reason === 'opponent-left');
    document.querySelector('#room-title').textContent = '경기 결과';
    readyButton.classList.add('hidden');
  }
}

function updateRoomUi() {
  if (!roomState) return;
  const players = roomState.players;
  playerCount.textContent = `${players.length} / 2`;
  playerList.innerHTML = players.map((player) => `
    <div class="player-row ${player.color === '#ff718e' ? 'pink' : ''}" data-player-id="${escapeHtml(player.id)}">
      <span class="player-swatch"></span><span class="player-name">${escapeHtml(player.name)}</span>
      <span class="player-score">${player.score || 0} PTS</span>
      ${player.id === myId ? '<span class="player-you">YOU</span>' : ''}
      ${player.ready ? '<span class="ready-tag">READY</span>' : ''}
    </div>`).join('');
  const opponent = players.find((player) => player.id !== myId);
  document.querySelector('.waiting-slot').classList.toggle('hidden', players.length > 1);
  readyButton.classList.remove('hidden');
  if (roomState.status === 'waiting') {
    clearInterval(countdownTimer);
    countdownOverlay.classList.add('hidden');
    gameStarted = false;
    readyButton.disabled = players.length < 2;
    readyLabel.textContent = players.length < 2 ? '상대 입장 대기 중' : ready ? '준비 완료 · 취소하기' : '대결 준비하기';
    readyButton.classList.toggle('is-ready', ready);
    roomMessage.classList.toggle('success', players.length === 2);
    roomMessage.lastElementChild.textContent = players.length < 2
      ? '친구가 들어오면 준비 버튼이 활성화돼요.'
      : opponent?.ready ? '두 분 모두 준비하면 바로 시작해요.' : '상대가 입장했어요. 준비를 눌러주세요!';
    arenaStatus.textContent = players.length < 2 ? 'WAITING FOR OPPONENT' : 'READY CHECK';
    waitingOverlay.classList.remove('hidden');
    waitingTitle.textContent = players.length < 2 ? '상대를 기다리는 중' : '대결 준비 완료';
    waitingCopy.textContent = players.length < 2 ? '친구에게 방 코드를 공유해 주세요.' : '두 플레이어가 준비를 누르면 시작합니다.';
  } else if (roomState.status === 'playing') {
    arenaStatus.textContent = 'MATCH IN PROGRESS';
    waitingOverlay.classList.add('hidden');
    countdownOverlay.classList.add('hidden');
    gameStarted = true;
    document.querySelector('#room-title').textContent = '대결 중';
    readyButton.classList.add('hidden');
  } else if (roomState.status === 'countdown') {
    arenaStatus.textContent = 'GET READY';
    waitingOverlay.classList.add('hidden');
    readyButton.classList.add('hidden');
  } else if (roomState.status === 'finished') {
    arenaStatus.textContent = 'MATCH COMPLETE';
    readyButton.classList.add('hidden');
  }
}

function startCountdown() {
  gameStarted = false;
  waitingOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  countdownOverlay.classList.remove('hidden');
  document.querySelector('#room-title').textContent = '대결 중';
  let count = 3;
  document.querySelector('#countdown-number').textContent = count;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    count -= 1;
    if (count > 0) {
      document.querySelector('#countdown-number').textContent = count;
    } else {
      clearInterval(countdownTimer);
      countdownOverlay.classList.add('hidden');
    }
  }, 700);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

document.querySelector('#create-room').addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return showToast('서버에 연결 중입니다. 잠시 후 다시 눌러주세요.');
  send({ type: 'createRoom', name: createName.value.trim() || 'Player 1' });
});
document.querySelector('#join-room').addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return showToast('서버에 연결 중입니다. 잠시 후 다시 눌러주세요.');
  if (joinCode.value.trim().length !== 4) return showToast('4자리 방 코드를 입력해 주세요.');
  send({ type: 'joinRoom', code: joinCode.value.trim(), name: joinName.value.trim() || 'Player 2' });
});
document.querySelectorAll('.bot-level').forEach((button) => {
  button.addEventListener('click', () => {
    botDifficulty = button.dataset.difficulty;
    document.querySelectorAll('.bot-level').forEach((level) => {
      const selected = level === button;
      level.classList.toggle('is-selected', selected);
      level.setAttribute('aria-pressed', String(selected));
    });
  });
});
document.querySelector('#start-bot').addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return showToast('서버에 연결 중입니다. 잠시 후 다시 눌러주세요.');
  send({ type: 'createBot', difficulty: botDifficulty, name: document.querySelector('#bot-name').value.trim() || 'Pilot' });
});
joinCode.addEventListener('input', () => { joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
readyButton.addEventListener('click', () => {
  ready = !ready;
  send({ type: 'ready', ready });
});
document.querySelector('#back-to-lobby').addEventListener('click', () => {
  send({ type: 'leaveRoom' });
  setTimeout(() => {
    if (currentRoom) {
      currentRoom = null;
      roomView.classList.add('hidden');
      lobbyView.classList.remove('hidden');
    }
  }, 100);
});
document.querySelector('#copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomCode.textContent);
    showToast('방 코드를 복사했어요!');
  } catch {
    showToast(`방 코드: ${roomCode.textContent}`);
  }
});
document.querySelector('#play-again').addEventListener('click', () => {
  readyButton.classList.remove('hidden');
  send({ type: 'playAgain' });
  document.querySelector('#room-title').textContent = '대기실';
});

const turnAngles = { arrowup: -Math.PI / 2, arrowright: 0, arrowdown: Math.PI / 2, arrowleft: Math.PI };
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  if (Object.hasOwn(turnAngles, key)) aimAngle = turnAngles[key];
  keys.add(key);
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); pointer.shooting = false; });

document.querySelectorAll('.mobile-key').forEach((button) => {
  const direction = button.dataset.key;
  const movementKey = { up: 'w', down: 's', left: 'a', right: 'd' }[direction];
  const directionAngle = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[direction];
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    keys.add(movementKey);
    aimAngle = directionAngle;
    button.setPointerCapture(event.pointerId);
  });
  const release = () => keys.delete(movementKey);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});
const mobileFire = document.querySelector('#mobile-fire');
mobileFire.addEventListener('pointerdown', (event) => { event.preventDefault(); pointer.shooting = true; mobileFire.setPointerCapture(event.pointerId); });
mobileFire.addEventListener('pointerup', () => { pointer.shooting = false; });
mobileFire.addEventListener('pointercancel', () => { pointer.shooting = false; });
mobileFire.addEventListener('lostpointercapture', () => { pointer.shooting = false; });

setInterval(() => {
  if (!gameStarted || !currentRoom) return;
  send({
    type: 'input',
    input: {
      up: keys.has('w'),
      down: keys.has('s'),
      left: keys.has('a'),
      right: keys.has('d'),
      angle: aimAngle,
      shoot: pointer.shooting || keys.has(' '),
    },
  });
}, 1000 / 30);

function drawArena() {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  const now = performance.now();
  const shake = Math.max(0, (shakeUntil - now) / 180) * 5;
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
  ctx.fillStyle = '#0a1017';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0d151d';
  ctx.fillRect(12, 12, width - 24, height - 24);

  ctx.strokeStyle = '#ffffff09';
  ctx.lineWidth = 1;
  for (let x = 24; x < width; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, height - 12); ctx.stroke();
  }
  for (let y = 12; y < height; y += 32) {
    ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(width - 12, y); ctx.stroke();
  }

  ctx.strokeStyle = '#65f6d01b';
  ctx.setLineDash([5, 8]);
  ctx.beginPath(); ctx.moveTo(width / 2, 25); ctx.lineTo(width / 2, height - 25); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffffff10';
  ctx.beginPath(); ctx.arc(width / 2, height / 2, 89, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(width / 2, height / 2, 7, 0, Math.PI * 2); ctx.stroke();

  for (const obstacle of obstacles) {
    ctx.fillStyle = '#151f29';
    ctx.strokeStyle = '#34424a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#65f6d050';
    ctx.fillRect(obstacle.x + 7, obstacle.y + 5, 3, obstacle.h - 10);
    ctx.fillStyle = '#ffffff20';
    ctx.fillRect(obstacle.x + 16, obstacle.y + 6, obstacle.w - 24, 2);
  }

  ctx.strokeStyle = '#65f6d044';
  ctx.strokeRect(13, 13, width - 26, height - 26);
  drawCorner(14, 14, 1, 1);
  drawCorner(width - 14, 14, -1, 1);
  drawCorner(14, height - 14, 1, -1);
  drawCorner(width - 14, height - 14, -1, -1);

  for (const bullet of gameState.bullets) {
    const owner = roomState?.players.find((player) => player.id === bullet.owner);
    const color = owner?.color || '#65f6d0';
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  for (let index = impactEffects.length - 1; index >= 0; index -= 1) {
    const effect = impactEffects[index];
    const progress = (now - effect.createdAt) / 480;
    if (progress >= 1) {
      impactEffects.splice(index, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = effect.color;
    ctx.shadowColor = effect.color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3 * (1 - progress) + 0.5;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, 8 + progress * 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, Math.max(0, 7 * (1 - progress)), 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    for (const spark of effect.sparks) {
      const distance = spark.distance * progress;
      const start = Math.max(0, distance - spark.length * (1 - progress));
      ctx.beginPath();
      ctx.moveTo(effect.x + Math.cos(spark.angle) * start, effect.y + Math.sin(spark.angle) * start);
      ctx.lineTo(effect.x + Math.cos(spark.angle) * distance, effect.y + Math.sin(spark.angle) * distance);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const player of gameState.players) drawPlayer(player);
  ctx.restore();
  requestAnimationFrame(drawArena);
}

function drawCorner(x, y, xDir, yDir) {
  ctx.strokeStyle = '#65f6d0';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + yDir * 17); ctx.lineTo(x, y); ctx.lineTo(x + xDir * 17, y); ctx.stroke();
}

function drawPlayer(player) {
  const config = roomState?.players.find((entry) => entry.id === player.id);
  const color = config?.color || '#65f6d0';
  const angle = player.angle || 0;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(angle);
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  if (fighterImage.complete && fighterImage.naturalWidth > 0) {
    ctx.drawImage(fighterImage, -34, -34, 68, 68);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-12, -12); ctx.lineTo(-7, 0); ctx.lineTo(-12, 12); ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0a1017';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = color;
  ctx.font = '11px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(config?.name || 'PLAYER', player.x, player.y + 42);
}

connect();
drawArena();
