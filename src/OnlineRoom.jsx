import { useEffect, useMemo, useRef, useState } from 'react';
import Peer from 'peerjs';
import { io } from 'socket.io-client';
import { questions } from './questions.js';

const ROUND_LENGTH = 10;
const COUNTDOWN_MS = 3000;
const REVEAL_MS = 1000;
const MATCH_WAIT_MS = 15000;
const MATCH_CONNECT_TIMEOUT_MS = 20000;
const ROOM_COLORS = ['#e3ae45', '#c94e3d', '#78b985', '#70a7bc', '#a78bc2', '#e49b9b'];
const MATCHMAKING_DISABLED = import.meta.env.VITE_MATCHMAKING_URL === 'disabled';
const MATCHMAKING_URL = MATCHMAKING_DISABLED
  ? ''
  : import.meta.env.VITE_MATCHMAKING_URL
    || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);
const PEER_OPTIONS = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  config: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  },
};

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function createRound() {
  return shuffle(questions).slice(0, ROUND_LENGTH).map((item) => {
    const options = shuffle(item.options.map((text, originalIndex) => ({ text, originalIndex })));
    return {
      id: item.id,
      text: item.text,
      emoji: item.emoji,
      category: item.category,
      options: options.map((option) => option.text),
      answerIndex: options.findIndex((option) => option.originalIndex === item.correctIndex),
    };
  });
}

function waitForPeerOpen(peer) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('خادم الاتصال ما ردّش. جرّب تاني بعد شوية.'));
    }, 15000);
    const onOpen = (peerId) => {
      cleanup();
      resolve(peerId);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      peer.off('open', onOpen);
      peer.off('error', onError);
    };
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

function peerErrorText(error) {
  if (error?.type === 'unavailable-id') return 'الكود ده مستخدم دلوقتي.';
  if (error?.type === 'peer-unavailable') return 'مش لاقيين ماستر بالكود ده. اتأكد إن الغرفة مفتوحة.';
  if (error?.type === 'network' || error?.type === 'socket-error' || error?.type === 'server-error') {
    return 'خدمة الاتصال مش متاحة دلوقتي. جرّب تاني أو اتأكد من الإنترنت.';
  }
  if (error?.type === 'browser-incompatible') return 'المتصفح ده مش بيدعم الاتصال المباشر المطلوب.';
  return error?.message || 'حصلت مشكلة في الاتصال. جرّب تاني.';
}

function createPeerId(code) {
  return `khotafha-${code}`;
}

function OnlineRoom({ initialMode = 'rooms', onBack, onFallbackComputer }) {
  const initialCode = new URLSearchParams(window.location.search).get('room') || '';
  const isMatchmaking = initialMode === 'matchmaking';
  const [roomCode, setRoomCode] = useState(initialCode.replace(/\D/g, '').slice(0, 4));
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState('');
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [durationSeconds, setDurationSeconds] = useState(12);
  const [hostOffset, setHostOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [responses, setResponses] = useState({});
  const [myAnswers, setMyAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const peerRef = useRef(null);
  const roomRef = useRef(null);
  const connectionsRef = useRef(new Map());
  const guestConnectionRef = useRef(null);
  const answerIndicesRef = useRef([]);
  const responsesRef = useRef({});
  const submitLockRef = useRef(false);
  const transitionKeyRef = useRef('');
  const matchSocketRef = useRef(null);
  const matchDetailsRef = useRef(null);
  const matchTimeoutRef = useRef(null);
  const randomMatchRef = useRef(false);

  const isHost = Boolean(room && playerId && room.hostId === playerId);
  const game = room?.game;
  const currentQuestion = game?.questions?.[game.questionIndex];
  const playerList = useMemo(() => room?.players || [], [room?.players]);
  const remainingMs = game?.deadlineAt
    ? Math.max(0, game.deadlineAt - (now + (isHost ? 0 : hostOffset)))
    : 0;
  const leaderboard = useMemo(() => [...(game?.players || [])].sort((first, second) => (
    (game?.scores?.[second.id] || 0) - (game?.scores?.[first.id] || 0)
  )), [game?.players, game?.scores]);

  function commitRoom(nextRoom) {
    roomRef.current = nextRoom;
    setRoom(nextRoom);
  }

  function sendToConnection(connection, message) {
    if (connection?.open) connection.send(message);
  }

  function broadcastRoom(nextRoom = roomRef.current) {
    if (!nextRoom) return;
    const message = { type: 'room', room: nextRoom, hostNow: Date.now() };
    connectionsRef.current.forEach((connection) => sendToConnection(connection, message));
  }

  function recordHostAnswer(answeringPlayerId, optionIndex) {
    const currentRoom = roomRef.current;
    const currentGame = currentRoom?.game;
    if (currentGame?.phase !== 'question' || Date.now() >= currentGame.deadlineAt) return false;
    if (!currentGame.players.some((player) => player.id === answeringPlayerId)) return false;
    if (responsesRef.current[answeringPlayerId]) return false;
    const nextResponses = {
      ...responsesRef.current,
      [answeringPlayerId]: { optionIndex, at: performance.now() },
    };
    responsesRef.current = nextResponses;
    setResponses(nextResponses);
    return true;
  }

  function handleHostConnection(connection) {
    connectionsRef.current.set(connection.peer, connection);

    connection.on('data', (message) => {
      if (!message || typeof message !== 'object') return;
      const currentRoom = roomRef.current;
      if (!currentRoom) return;

      if (message.type === 'join') {
        const cleanName = typeof message.name === 'string' ? message.name.trim().slice(0, 12) : '';
        const alreadyJoined = currentRoom.players.some((player) => player.id === connection.peer);
        if (currentRoom.game?.phase !== 'lobby') {
          sendToConnection(connection, { type: 'reject', text: 'الجولة بدأت خلاص.. استنى الجولة الجاية.' });
          connection.close();
          return;
        }
        if (!cleanName) {
          sendToConnection(connection, { type: 'reject', text: 'اكتب اسم صحيح وجرب تاني.' });
          connection.close();
          return;
        }
        if (!alreadyJoined && currentRoom.players.length >= currentRoom.settings.maxPlayers) {
          sendToConnection(connection, { type: 'reject', text: 'الغرفة كملت عددها.' });
          connection.close();
          return;
        }
        if (randomMatchRef.current && matchTimeoutRef.current) {
          window.clearTimeout(matchTimeoutRef.current);
          matchTimeoutRef.current = null;
        }
        const nextRoom = alreadyJoined
          ? currentRoom
          : {
            ...currentRoom,
            players: [...currentRoom.players, { id: connection.peer, name: cleanName }],
          };
        commitRoom(nextRoom);
        sendToConnection(connection, {
          type: 'welcome',
          room: nextRoom,
          playerId: connection.peer,
          hostNow: Date.now(),
        });
        broadcastRoom(nextRoom);
        return;
      }

      if (message.type === 'leave') {
        if (roomRef.current?.game?.phase === 'lobby') {
          const nextRoom = {
            ...roomRef.current,
            players: roomRef.current.players.filter((player) => player.id !== connection.peer),
          };
          commitRoom(nextRoom);
          broadcastRoom(nextRoom);
        }
        connectionsRef.current.delete(connection.peer);
        connection.close();
        return;
      }

      if (
        message.type === 'answer'
        && Number.isInteger(message.optionIndex)
        && message.optionIndex >= 0
        && message.optionIndex <= 3
        && message.questionIndex === currentRoom.game?.questionIndex
      ) {
        recordHostAnswer(connection.peer, message.optionIndex);
      }
    });

    connection.on('close', () => {
      connectionsRef.current.delete(connection.peer);
      const currentRoom = roomRef.current;
      if (currentRoom?.game?.phase === 'lobby' && currentRoom.players.some((player) => player.id === connection.peer)) {
        const nextRoom = {
          ...currentRoom,
          players: currentRoom.players.filter((player) => player.id !== connection.peer),
        };
        commitRoom(nextRoom);
        broadcastRoom(nextRoom);
      }
    });

    connection.on('error', (connectionError) => {
      setError(`اتصال لاعب فصل: ${peerErrorText(connectionError)}`);
    });
  }

  function listenAsHost(peer) {
    peer.on('connection', handleHostConnection);
    peer.on('error', (peerError) => setError(peerErrorText(peerError)));
    peer.on('open', () => setError(''));
    peer.on('disconnected', () => {
      if (!peer.destroyed) {
        setError('الاتصال بخادم الإشارات فصل.. بنحاول نرجّعه.');
        peer.reconnect();
      }
    });
  }

  function listenAsGuest(peer, connection, guestName) {
    guestConnectionRef.current = connection;
    connection.on('open', () => {
      connection.send({ type: 'join', name: guestName });
    });
    connection.on('data', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'reject') {
        setError(message.text || 'الماستر رفض دخول الغرفة.');
        connection.close();
      } else if (message.type === 'welcome') {
        if (matchTimeoutRef.current) window.clearTimeout(matchTimeoutRef.current);
        matchTimeoutRef.current = null;
        setBusy(false);
        setPlayerId(message.playerId);
        setHostOffset(message.hostNow - Date.now());
        commitRoom(message.room);
        setError('');
      } else if (message.type === 'room') {
        setHostOffset(message.hostNow - Date.now());
        commitRoom(message.room);
      } else if (message.type === 'closed') {
        setError('الماستر قفل الغرفة.');
        commitRoom(null);
        setRoomCode('');
        window.history.replaceState({}, '', window.location.pathname);
      }
    });
    connection.on('error', (connectionError) => setError(peerErrorText(connectionError)));
    connection.on('close', () => {
      guestConnectionRef.current = null;
      if (!roomRef.current) {
        setBusy(false);
      } else {
        setError('الاتصال بالماستر فصل. جرّب ترجع للغرفة أو تعيد تحميل الصفحة.');
      }
    });
    peer.on('error', (peerError) => {
      if (peerError.type === 'peer-unavailable') setError('مش لاقيين ماستر بالكود ده. اتأكد من الكود وإن الغرفة مفتوحة.');
      else setError(peerErrorText(peerError));
      if (!roomRef.current) {
        setBusy(false);
        connection.close();
        peer.destroy();
        peerRef.current = null;
      }
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) {
        setError('اتصال الإشارات فصل.. بنحاول نرجّعه.');
        peer.reconnect();
      }
    });
    peer.on('open', () => setError(''));
  }

  function destroyPeer() {
    connectionsRef.current.forEach((connection) => connection.close());
    connectionsRef.current.clear();
    guestConnectionRef.current?.close();
    guestConnectionRef.current = null;
    peerRef.current?.destroy();
    peerRef.current = null;
  }

  function closeMatchmaking() {
    if (matchTimeoutRef.current) {
      window.clearTimeout(matchTimeoutRef.current);
      matchTimeoutRef.current = null;
    }
    const socket = matchSocketRef.current;
    matchSocketRef.current = null;
    matchDetailsRef.current = null;
    randomMatchRef.current = false;
    if (socket) {
      socket.emit('matchmaking:cancel');
      socket.disconnect();
    }
  }

  function fallBackToComputer(playerName) {
    closeMatchmaking();
    destroyPeer();
    onFallbackComputer(playerName.trim().slice(0, 12) || 'لاعب ١');
  }

  async function createRandomMatchHost(match, hostName) {
    const peer = new Peer(match.peerId, PEER_OPTIONS);
    peerRef.current = peer;
    listenAsHost(peer);
    try {
      const id = await waitForPeerOpen(peer);
      setRoomCode('عشوائي');
      setBusy(false);
      setPlayerId(id);
      answerIndicesRef.current = [];
      transitionKeyRef.current = '';
      commitRoom({
        hostId: id,
        code: 'عشوائي',
        settings: { maxPlayers: 2, durationSeconds: 12 },
        players: [{ id, name: hostName }],
        game: { phase: 'lobby' },
      });
      matchSocketRef.current?.emit('matchmaking:host-ready');
    } catch (peerError) {
      peer.destroy();
      peerRef.current = null;
      setBusy(false);
      setError(`مش قادرين نجهّز الاتصال باللاعب: ${peerErrorText(peerError)}`);
      closeMatchmaking();
    }
  }

  async function connectRandomMatchGuest(guestName, peerId) {
    const peer = new Peer(undefined, PEER_OPTIONS);
    peerRef.current = peer;
    try {
      await waitForPeerOpen(peer);
      const connection = peer.connect(peerId, { reliable: true });
      listenAsGuest(peer, connection, guestName);
      const timeoutId = window.setTimeout(() => {
        if (!roomRef.current) {
          setBusy(false);
          setError('الاتصال باللاعب ما اكتملش. جرّب تاني أو العب مع الكمبيوتر.');
        }
      }, 18000);
      connection.on('open', () => {
        window.clearTimeout(timeoutId);
        matchSocketRef.current?.emit('matchmaking:peer-connected');
        setRoomCode('عشوائي');
        window.history.replaceState({}, '', window.location.pathname);
      });
      connection.on('close', () => window.clearTimeout(timeoutId));
    } catch (peerError) {
      peer.destroy();
      peerRef.current = null;
      setBusy(false);
      setError(`مش قادرين نوصل للاعب: ${peerErrorText(peerError)}`);
      closeMatchmaking();
    }
  }

  function findRandomMatch() {
    const playerName = name.trim().slice(0, 12);
    if (!playerName) {
      setError('اكتب اسمك الأول، لحد ١٢ حرف.');
      return;
    }
    if (MATCHMAKING_DISABLED) {
      setError('المطابقة العشوائية مش متاحة على GitHub Pages. افتح نسخة Render من رابط الموقع.');
      return;
    }
    if (!MATCHMAKING_URL) {
      setError('خدمة المطابقة العشوائية مش متوصلة بالموقع. العب مع الكمبيوتر دلوقتي.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('بنوصل بخدمة المطابقة…');
    const socket = io(MATCHMAKING_URL, {
      autoConnect: false,
      reconnection: false,
      timeout: 5000,
    });
    matchSocketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('matchmaking:join', { name: playerName }, (result) => {
        if (!result?.ok) {
          setBusy(false);
          setError(result?.error || 'مش قادرين ندخلك طابور المطابقة.');
          closeMatchmaking();
          return;
        }
        if (result.status === 'waiting') {
          setNotice('بندورلك على لاعب… لو محدش دخل خلال ١٥ ثانية هنبدأ مع الكمبيوتر.');
          matchTimeoutRef.current = window.setTimeout(
            () => fallBackToComputer(playerName),
            MATCH_WAIT_MS,
          );
        }
      });
    });
    socket.on('connect_error', () => {
      setBusy(false);
      setError('خدمة المطابقة مش متاحة دلوقتي. جرّب مع الكمبيوتر أو اتأكد من اتصال الخادم.');
      closeMatchmaking();
    });
    socket.on('matchmaking:matched', (match) => {
      if (matchTimeoutRef.current) window.clearTimeout(matchTimeoutRef.current);
      matchDetailsRef.current = match;
      randomMatchRef.current = true;
      setNotice(`لقينا لاعب ${match.opponentName}.. بنجهز الجولة!`);
      matchTimeoutRef.current = window.setTimeout(
        () => fallBackToComputer(playerName),
        MATCH_CONNECT_TIMEOUT_MS,
      );
      if (match.role === 'host') {
        createRandomMatchHost(match, playerName);
      }
    });
    socket.on('matchmaking:host-ready', ({ peerId }) => {
      const match = matchDetailsRef.current;
      if (match?.role === 'guest' && typeof peerId === 'string') {
        connectRandomMatchGuest(playerName, peerId);
      }
    });
    socket.on('matchmaking:peer-left', () => {
      destroyPeer();
      roomRef.current = null;
      commitRoom(null);
      setPlayerId('');
      setRoomCode('');
      setBusy(false);
      setError('اللاعب خرج قبل ما تبدأ الجولة. جرّب تاني أو العب مع الكمبيوتر.');
      closeMatchmaking();
    });
    socket.on('matchmaking:error', (message) => {
      setBusy(false);
      setError(message || 'حصلت مشكلة في المطابقة.');
    });
    socket.connect();
  }

  useEffect(() => () => {
    if (matchTimeoutRef.current) window.clearTimeout(matchTimeoutRef.current);
    matchSocketRef.current?.disconnect();
    connectionsRef.current.forEach((connection) => connection.close());
    guestConnectionRef.current?.close();
    peerRef.current?.destroy();
  }, []);

  useEffect(() => {
    if (!room || !isHost) return;
    broadcastRoom(room);
  }, [room, isHost]);

  useEffect(() => {
    if (!room || !randomMatchRef.current || !isHost || room.game?.phase !== 'lobby' || room.players.length < 2) return;
    startRound();
  }, [room, isHost]);

  useEffect(() => {
    if (!game || !['countdown', 'question', 'reveal'].includes(game.phase)) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [game?.phase, game?.deadlineAt]);

  useEffect(() => {
    if (game?.phase !== 'question') return;
    const reset = window.setTimeout(() => {
      submitLockRef.current = false;
    }, 0);
    return () => window.clearTimeout(reset);
  }, [game?.roundId, game?.questionIndex]);

  useEffect(() => {
    setMyAnswers({});
    submitLockRef.current = false;
  }, [game?.roundId]);

  useEffect(() => {
    if (!isHost || !game || !['countdown', 'question', 'reveal'].includes(game.phase)) return;
    const expired = Date.now() >= game.deadlineAt;
    const allAnswered = game.phase === 'question'
      && game.players.every((player) => responses[player.id]);
    if (!expired && !allAnswered) return;

    const transitionKey = `${game.roundId}:${game.phase}:${game.questionIndex}`;
    if (transitionKeyRef.current === transitionKey) return;
    transitionKeyRef.current = transitionKey;

    const hostNow = Date.now();
    let nextGame;
    if (game.phase === 'countdown') {
      nextGame = {
        ...game,
        phase: 'question',
        questionIndex: 0,
        deadlineAt: hostNow + game.durationSeconds * 1000,
        reveal: null,
      };
    } else if (game.phase === 'question') {
      const answerIndex = answerIndicesRef.current[game.questionIndex];
      const submitted = Object.entries(responses).map(([id, answer]) => ({ id, ...answer }));
      const correct = submitted
        .filter((answer) => answer.optionIndex === answerIndex)
        .sort((first, second) => first.at - second.at);
      const scores = { ...game.scores };
      submitted.filter((answer) => answer.optionIndex !== answerIndex).forEach((answer) => {
        scores[answer.id] = (scores[answer.id] || 0) - 3;
      });
      correct.forEach((answer, rank) => {
        scores[answer.id] = (scores[answer.id] || 0) + ([10, 6, 4, 2][rank] || 2);
      });
      nextGame = {
        ...game,
        phase: 'reveal',
        scores,
        deadlineAt: hostNow + REVEAL_MS,
        reveal: {
          correctAnswer: game.questions[game.questionIndex].options[answerIndex],
          winnerId: correct[0]?.id || null,
          correctPlayerIds: correct.map((answer) => answer.id),
          wrongPlayerIds: submitted.filter((answer) => answer.optionIndex !== answerIndex).map((answer) => answer.id),
        },
      };
    } else {
      const nextIndex = game.questionIndex + 1;
      nextGame = nextIndex >= game.questions.length
        ? { ...game, phase: 'results', deadlineAt: null }
        : {
          ...game,
          phase: 'question',
          questionIndex: nextIndex,
          deadlineAt: hostNow + game.durationSeconds * 1000,
          reveal: null,
        };
    }

    const nextRoom = { ...room, game: nextGame };
    responsesRef.current = {};
    setResponses({});
    commitRoom(nextRoom);
  }, [isHost, game, game?.phase, game?.roundId, game?.questionIndex, game?.deadlineAt, now, responses, room]);

  async function createRoom(event) {
    event.preventDefault();
    const hostName = name.trim().slice(0, 12);
    if (!hostName) {
      setError('اكتب اسمك الأول، لحد ١٢ حرف.');
      return;
    }
    setBusy(true);
    setError('');
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const candidate = String(1000 + Math.floor(Math.random() * 9000));
      const peer = new Peer(createPeerId(candidate), PEER_OPTIONS);
      peerRef.current = peer;
      try {
        const id = await waitForPeerOpen(peer);
        setRoomCode(candidate);
        setPlayerId(id);
        answerIndicesRef.current = [];
        transitionKeyRef.current = '';
        const newRoom = {
          hostId: id,
          code: candidate,
          settings: { maxPlayers, durationSeconds },
          players: [{ id, name: hostName }],
          game: { phase: 'lobby' },
        };
        commitRoom(newRoom);
        listenAsHost(peer);
        window.history.replaceState({}, '', `${window.location.pathname}?room=${candidate}`);
        setBusy(false);
        return;
      } catch (peerError) {
        peer.destroy();
        peerRef.current = null;
        if (peerError.type !== 'unavailable-id') {
          setError(`تعذّر فتح غرفة الاتصال: ${peerErrorText(peerError)}`);
          setBusy(false);
          return;
        }
      }
    }
    setError('الأكواد اللي جرّبناها مستخدمة. جرّب بعد شوية.');
    setBusy(false);
  }

  async function joinRoom(event) {
    event.preventDefault();
    const guestName = name.trim().slice(0, 12);
    const code = roomCode.replace(/\D/g, '').slice(0, 4);
    if (!guestName) {
      setError('اكتب اسمك الأول، لحد ١٢ حرف.');
      return;
    }
    if (code.length !== 4) {
      setError('كود الغرفة لازم يبقى ٤ أرقام.');
      return;
    }
    setBusy(true);
    setError('');
    const peer = new Peer(undefined, PEER_OPTIONS);
    peerRef.current = peer;
    try {
      await waitForPeerOpen(peer);
      const connection = peer.connect(createPeerId(code), { reliable: true });
      listenAsGuest(peer, connection, guestName);
      const timeoutId = window.setTimeout(() => {
        if (!roomRef.current && connection.open) {
          setError('الماستر ما ردّش. اتأكد إن الغرفة لسه مفتوحة وجرب تاني.');
          setBusy(false);
        }
      }, 18000);
      connection.on('open', () => {
        window.clearTimeout(timeoutId);
        setBusy(false);
        setRoomCode(code);
        window.history.replaceState({}, '', `${window.location.pathname}?room=${code}`);
      });
    } catch (peerError) {
      peer.destroy();
      peerRef.current = null;
      setError(`تعذّر دخول الغرفة: ${peerErrorText(peerError)}`);
      setBusy(false);
    }
  }

  function startRound() {
    if (!isHost || !room || room.players.length < 2) return;
    const shuffledRound = createRound();
    answerIndicesRef.current = shuffledRound.map((question) => question.answerIndex);
    responsesRef.current = {};
    setResponses({});
    setMyAnswers({});
    submitLockRef.current = false;
    transitionKeyRef.current = '';
    const gamePlayers = room.players.map((player) => ({ ...player }));
    const nextGame = {
      phase: 'countdown',
      roundId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      players: gamePlayers,
      questions: shuffledRound.map(({ answerIndex, ...question }) => question),
      questionIndex: -1,
      scores: Object.fromEntries(gamePlayers.map((player) => [player.id, 0])),
      durationSeconds: room.settings.durationSeconds,
      deadlineAt: Date.now() + COUNTDOWN_MS,
      reveal: null,
    };
    commitRoom({ ...room, game: nextGame });
  }

  function submitAnswer(optionIndex) {
    if (!game || game.phase !== 'question' || myAnswers[game.questionIndex] !== undefined || submitLockRef.current) return;
    if (!isHost && !guestConnectionRef.current?.open) {
      setError('اتصالك بالماستر فصل.. إجابتك ماوصلتش.');
      return;
    }
    submitLockRef.current = true;
    setMyAnswers((current) => ({ ...current, [game.questionIndex]: optionIndex }));
    if (isHost) {
      if (!recordHostAnswer(playerId, optionIndex)) {
        submitLockRef.current = false;
        setMyAnswers((current) => {
          const next = { ...current };
          delete next[game.questionIndex];
          return next;
        });
        setError('الوقت خلص.. استنوا السؤال اللي بعده!');
      }
      return;
    }
    try {
      guestConnectionRef.current.send({
        type: 'answer',
        optionIndex,
        questionIndex: game.questionIndex,
      });
    } catch (sendError) {
      submitLockRef.current = false;
      setMyAnswers((current) => {
        const next = { ...current };
        delete next[game.questionIndex];
        return next;
      });
      setError(`إجابتك ماوصلتش: ${peerErrorText(sendError)}`);
    }
  }

  function exitRoom() {
    if (isHost && room?.game?.phase === 'lobby') {
      connectionsRef.current.forEach((connection) => sendToConnection(connection, { type: 'closed' }));
    } else if (!isHost) {
      sendToConnection(guestConnectionRef.current, { type: 'leave' });
    }
    destroyPeer();
    closeMatchmaking();
    roomRef.current = null;
    setRoom(null);
    setPlayerId('');
    setResponses({});
    setMyAnswers({});
    setRoomCode('');
    setError('');
    window.history.replaceState({}, '', window.location.pathname);
  }

  function closeRoomAfterGame() {
    connectionsRef.current.forEach((connection) => sendToConnection(connection, { type: 'closed' }));
    destroyPeer();
    closeMatchmaking();
    roomRef.current = null;
    setRoom(null);
    setPlayerId('');
    setRoomCode('');
    window.history.replaceState({}, '', window.location.pathname);
    onBack();
  }

  async function shareInvite() {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    const message = `تعالى العب خطفها معايا! ادخل غرفة رقم ${roomCode}: ${inviteUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'غرفة خطفها', text: message, url: inviteUrl });
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
      }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setError('مش قادرين نفتح المشاركة. انسخ الرابط من شريط العنوان.');
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${roomCode}`);
      setNotice('نسخنا الرابط.. ابعته لصحابك!');
      window.setTimeout(() => setNotice(''), 2500);
    } catch (copyError) {
      setError('المتصفح مانع النسخ التلقائي. انسخ الرابط من شريط العنوان.');
    }
  }

  if (!room || !playerId) {
    return (
      <main className="setup-shell">
        <header className="topbar">
          <button className="back-button" type="button" onClick={() => { exitRoom(); onBack(); }}>← رجوع</button>
          <span className="brand-name">غرفة خطفها</span>
        </header>
        <section className="setup-panel">
          <div className="section-kicker">
            {isMatchmaking ? 'تحدّي عشوائي' : initialCode ? 'وصلك لينك دعوة؟' : 'اللعب أونلاين مع صحابك'}
          </div>
          <h1>
            {isMatchmaking
              ? 'ندورلك على لاعب'
              : initialCode ? 'اكتب اسمك وادخل' : 'اعملوا غرفة والعبوا سوا'}
          </h1>
          <label className="name-field online-name">
            <span>اسمك</span>
            <input maxLength={12} value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم من ١٢ حرف" disabled={busy} />
            <small>{name.length}/12</small>
          </label>
          {isMatchmaking ? (
            <>
              <button className="primary-button start-button" type="button" onClick={findRandomMatch} disabled={busy}>
                {busy ? 'بندورلك على لاعب…' : 'ابدأ البحث عن لاعب عشوائي ⚡'}
              </button>
              {busy && (
                <div className="waiting-badge" aria-live="polite">
                  {notice || 'لو محدش دخل خلال ١٥ ثانية هنبدأ مع الكمبيوتر.'}
                </div>
              )}
              {!busy && error && (
                <button
                  className="secondary-button start-button"
                  type="button"
                  onClick={() => fallBackToComputer(name)}
                >
                  العب مع الكمبيوتر بدل كده
                </button>
              )}
            </>
          ) : initialCode ? (
            <form onSubmit={joinRoom} className="online-form">
              <label className="name-field online-name">
                <span>كود الغرفة</span>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="١٢٣٤"
                />
                <small>{roomCode.length}/4</small>
              </label>
              <button className="primary-button start-button" type="submit" disabled={busy}>
                {busy ? 'بنتصل بالماستر…' : 'ادخل الغرفة'}
              </button>
            </form>
          ) : (
            <>
              <div className="online-settings">
                <label>
                  <span>عدد اللاعبين</span>
                  <select value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
                    {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} لاعبين</option>)}
                  </select>
                </label>
                <label>
                  <span>وقت السؤال</span>
                  <select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                    {[8, 12, 15, 20].map((seconds) => <option key={seconds} value={seconds}>{seconds} ثانية</option>)}
                  </select>
                </label>
              </div>
              <button className="primary-button start-button" type="button" onClick={createRoom} disabled={busy}>
                {busy ? 'بنحجز كود للغرفة…' : 'اعمل غرفة جديدة'}
              </button>
              <div className="room-join-divider"><span>أو</span></div>
              <form onSubmit={joinRoom} className="online-form">
                <label className="name-field online-name">
                  <span>كود الغرفة</span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={roomCode}
                    onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="٤ أرقام"
                  />
                  <small>{roomCode.length}/4</small>
                </label>
                <button className="secondary-button start-button" type="submit" disabled={busy}>ادخل بكود الغرفة</button>
              </form>
            </>
          )}
          <p className="setup-hint">
            {isMatchmaking
              ? 'هنستنى لاعب واحد لمدة ١٥ ثانية، وبعدها نبدأ جولة مع الكمبيوتر تلقائيًا.'
              : 'مش محتاج Firebase ولا مفاتيح. الغرف بتستخدم خدمة اتصال عامة.'}
          </p>
          {notice && !busy && <p className="inline-note" role="status">{notice}</p>}
          {error && <p className="inline-note" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  if (game?.phase === 'lobby' || !game?.phase) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    return (
      <main className="setup-shell">
        <header className="topbar">
          <button className="back-button" type="button" onClick={exitRoom}>سيب الغرفة</button>
          <span className="brand-name">غرفة خطفها</span>
        </header>
        <section className="setup-panel lobby-panel">
          <div className="section-kicker">{isHost ? 'إنت الماستر.. استنى صحابك' : 'دخلت الغرفة.. أهلاً بيك'}</div>
          <h1>الغرفة رقم <span className="room-code">{roomCode}</span></h1>
          <div className="invite-actions">
            <button className="primary-button" type="button" onClick={shareInvite}>ابعت اللينك على واتساب ↗</button>
            <button className="secondary-button" type="button" onClick={copyInvite}>انسخ اللينك</button>
          </div>
          <p className="room-share-link" dir="ltr">{inviteUrl}</p>
          <div className="room-player-heading">
            <strong>اللاعبين اللي دخلوا</strong>
            <span>{playerList.length}/{room.settings.maxPlayers}</span>
          </div>
          <div className="room-player-list">
            {playerList.map((player, index) => (
              <div className="room-player" key={player.id}>
                <span className="name-dot" style={{ backgroundColor: ROOM_COLORS[index % ROOM_COLORS.length] }} />
                <strong>{player.name}</strong>
                {player.id === room.hostId && <span className="host-badge">الماستر</span>}
                {player.id === playerId && <span className="you-badge">إنت</span>}
              </div>
            ))}
          </div>
          <p className="setup-hint">
            {room.settings.durationSeconds} ثانية لكل سؤال · ١٠ أسئلة · {isHost ? 'دوس ابدأ لما الكل يدخل' : 'مستنيين الماستر يبدأ الجولة'}
          </p>
          {isHost ? (
            <button className="primary-button start-button" type="button" onClick={startRound} disabled={playerList.length < 2}>
              {playerList.length < 2 ? 'مستنيين لاعب كمان' : 'ابدأ الجولة لكل الناس ⚡'}
            </button>
          ) : (
            <div className="waiting-badge" aria-live="polite">⏳ مستنيين الماستر يدوس ابدأ…</div>
          )}
          {error && <p className="inline-note" role="alert">{error}</p>}
          {notice && <p className="inline-note" role="status">{notice}</p>}
        </section>
      </main>
    );
  }

  if (game.phase === 'results') {
    return (
      <main className="results-shell">
        <header className="topbar">
          <span className="brand-name">غرفة {roomCode}</span>
        </header>
        <section className="results-panel online-results">
          <div className="winner-cup">🏆</div>
          <div className="section-kicker">خلصت الجولة.. عاش يا أبطال!</div>
          <h1>الترتيب النهائي</h1>
          <div className="ranking-list">
            {leaderboard.map((player, index) => (
              <div className={`rank-row ${index === 0 ? 'top-rank' : ''}`} key={player.id}>
                <span className="rank-number">{index === 0 ? '👑' : index + 1}</span>
                <span className="rank-name">{player.name}<small>{index === 0 ? 'برق الحارة' : index === leaderboard.length - 1 ? 'نايم في العسل' : 'خاطف على قدّه'}</small></span>
                <strong>{game.scores[player.id] || 0}<small>نقطة</small></strong>
              </div>
            ))}
          </div>
          {isHost ? (
            <>
              <button className="primary-button start-button" type="button" onClick={startRound}>جولة تانية ↻</button>
              <button className="secondary-button start-button" type="button" onClick={closeRoomAfterGame}>اقفل الغرفة وارجع</button>
            </>
          ) : (
            <button className="secondary-button start-button" type="button" onClick={exitRoom}>ارجع للصفحة الرئيسية</button>
          )}
        </section>
      </main>
    );
  }

  const progress = game.phase === 'question'
    ? Math.max(0, Math.min(100, (remainingMs / (game.durationSeconds * 1000)) * 100))
    : 0;
  const myAnswer = myAnswers[game.questionIndex];
  const myRevealResponse = game.reveal?.correctPlayerIds?.includes(playerId)
    ? 'correct'
    : game.reveal?.wrongPlayerIds?.includes(playerId) ? 'wrong' : '';

  return (
    <main className="online-game-shell">
      <header className="online-game-header">
        {isHost
          ? <button className="online-exit-button" type="button" onClick={closeRoomAfterGame}>اقفل الجولة</button>
          : <button className="online-exit-button" type="button" onClick={exitRoom}>اخرج</button>}
        <strong>{game.phase === 'countdown' ? 'استعدوا!' : `السؤال ${game.questionIndex + 1} / ${game.questions.length}`}</strong>
        <span className="online-room-chip">⚡ {roomCode}</span>
      </header>
      {game.phase === 'countdown' ? (
        <section className="countdown-stage">
          <p>الماستر بدأ.. خليك جاهز!</p>
          <div className="countdown-number">{Math.max(1, Math.ceil(remainingMs / 1000))}</div>
          <span>كلنا هنبدأ سوا.. حضّر إيدك 👀</span>
        </section>
      ) : (
        <>
          <section className={`online-question-card ${game.phase === 'reveal' ? 'revealing' : ''}`}>
            <div className="question-meta">
              <span>{currentQuestion?.category}</span>
              <span>{game.phase === 'question' ? `${game.durationSeconds} ثانية.. يلا!` : 'الإجابة الصح'}</span>
            </div>
            <div className="question-word">
              <span>{currentQuestion?.emoji}</span>
              <strong>{currentQuestion?.text}</strong>
            </div>
            {game.phase === 'question'
              ? <div className="timer-track"><div className="timer-fill" style={{ width: `${progress}%` }} /></div>
              : <div className="reveal-message"><strong>{game.reveal?.correctAnswer}</strong><span>{game.reveal?.winnerId ? `خطفها ${game.players.find((player) => player.id === game.reveal.winnerId)?.name} ⚡` : 'محدش لحقها المرة دي!'}</span></div>}
            {isHost && game.phase === 'question' && (
              <small className="host-response-count">{Object.keys(responses).length}/{game.players.length} جاوبوا</small>
            )}
          </section>
          <section className="online-answer-grid">
            {currentQuestion?.options.map((option, index) => {
              const selected = myAnswer === index;
              const isCorrectAnswer = game.phase === 'reveal' && option === game.reveal?.correctAnswer;
              const isMyWrong = game.phase === 'reveal' && selected && myRevealResponse === 'wrong';
              const choiceClass = isMyWrong
                ? 'answer-wrong'
                : isCorrectAnswer
                  ? 'answer-correct'
                  : selected ? 'answer-selected' : '';
              const marker = game.phase === 'reveal' && selected && myRevealResponse === 'correct'
                ? '✓ صح'
                : isMyWrong
                  ? '✕ إجابتك غلط'
                  : isCorrectAnswer
                    ? '✓ الصح'
                    : selected ? 'اختيارك' : '';
              return (
                <button
                  className={`online-answer-button ${choiceClass}`}
                  key={`${currentQuestion.id}-${index}`}
                  type="button"
                  aria-pressed={selected}
                  disabled={game.phase !== 'question' || myAnswer !== undefined}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    submitAnswer(index);
                  }}
                >
                  <span className="option-letter">{['أ', 'ب', 'ج', 'د'][index]}</span>
                  <span>{option}</span>
                  {marker && <span className="answer-marker">{marker}</span>}
                </button>
              );
            })}
          </section>
          <div className="online-game-footer">
            <span>{game.players.length} لاعبين في الجولة</span>
            {myAnswer !== undefined && game.phase === 'question' && <strong>اختيارك متحدد.. النتيجة بعد ما السؤال يخلص!</strong>}
            {myRevealResponse === 'correct' && <strong>إجابتك صح.. عاش! ⚡</strong>}
            {myRevealResponse === 'wrong' && <strong>معلش، المرة الجاية تخطفها!</strong>}
          </div>
        </>
      )}
      {error && <div className="toast" role="alert">{error}</div>}
    </main>
  );
}

export default OnlineRoom;
