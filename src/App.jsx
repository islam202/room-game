import { Suspense, lazy, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createInitialState, gameReducer, QUESTION_COUNT } from './gameReducer.js';
import { questions } from './questions.js';

const OnlineRoom = lazy(() => import('./OnlineRoom.jsx'));

const playerColors = [
  { name: 'tea', color: '#e3ae45', dark: '#573a0b' },
  { name: 'tomato', color: '#c94e3d', dark: '#fff6df' },
  { name: 'mint', color: '#78b985', dark: '#173c30' },
  { name: 'blue', color: '#70a7bc', dark: '#123440' },
  { name: 'plum', color: '#a78bc2', dark: '#30203d' },
  { name: 'pink', color: '#e49b9b', dark: '#492326' },
];

function readSavedPlayers() {
  try {
    const saved = JSON.parse(localStorage.getItem('khotafha-players') || 'null');
    if (!Array.isArray(saved) || saved.length < 2 || saved.length > 6) return [];
    return saved.map((player, index) => ({
      id: `p${index + 1}`,
      name: typeof player.name === 'string' ? player.name.slice(0, 12) : `لاعب ${index + 1}`,
    }));
  } catch (error) {
    console.warn('تعذّر قراءة أسماء اللاعبين المحفوظة:', error);
    return [];
  }
}

function readMutedPreference() {
  try {
    return localStorage.getItem('khotafha-muted') === 'true';
  } catch (error) {
    console.warn('تعذّرت قراءة إعداد الصوت:', error);
    return false;
  }
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function makeRound() {
  return shuffle(questions).slice(0, QUESTION_COUNT).map((question) => {
    const indexedOptions = question.options.map((option, index) => ({ option, index }));
    const shuffledOptions = shuffle(indexedOptions);
    return {
      ...question,
      options: shuffledOptions.map(({ option }) => option),
      correctIndex: shuffledOptions.findIndex(({ index }) => index === question.correctIndex),
    };
  });
}

function playTone(kind, muted) {
  if (muted) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = kind === 'good' ? 740 : 190;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.17);
    oscillator.onended = () => context.close();
  } catch (error) {
    console.warn('تعذّر تشغيل الصوت:', error);
  }
}

function getTitle(rank, total) {
  if (rank === 0) return 'برق الحارة';
  if (rank === total - 1) return 'نايم في العسل';
  if (rank === 1) return 'إيده سابقة كلامه';
  return 'خاطف على قدّه';
}

function App() {
  const savedPlayers = useMemo(readSavedPlayers, []);
  const [state, dispatch] = useReducer(gameReducer, savedPlayers, createInitialState);
  const [draftPlayers, setDraftPlayers] = useState(() => (
    savedPlayers.length ? savedPlayers : [
      { id: 'p1', name: 'لاعب ١' },
      { id: 'p2', name: 'لاعب ٢' },
    ]
  ));
  const [muted, setMuted] = useState(readMutedPreference);
  const [clockNow, setClockNow] = useState(() => performance.now());
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(() => (
    new URLSearchParams(window.location.search).has('room') ? 'online' : 'home'
  ));
  const [questionDurationSeconds, setQuestionDurationSeconds] = useState(12);

  useEffect(() => {
    try {
      localStorage.setItem('khotafha-muted', String(muted));
    } catch (error) {
      console.warn('تعذّر حفظ إعداد الصوت:', error);
    }
  }, [muted]);

  useEffect(() => {
    if (!['countdown', 'question', 'reveal'].includes(state.phase) || state.deadline === null) return undefined;
    let frameId;
    let lastPaint = 0;
    let tickSent = false;
    const update = (now) => {
      if (now - lastPaint >= 35 || now >= state.deadline) {
        setClockNow(now);
        lastPaint = now;
      }
      if (!tickSent && now >= state.deadline) {
        tickSent = true;
        dispatch({ type: 'TICK', now });
        return;
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [state.phase, state.deadline]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const currentQuestion = state.questions[state.questionIndex];
  const ranking = useMemo(() => [...state.players].sort((a, b) => (
    (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0)
  )), [state.players, state.scores]);

  function startRound(players = draftPlayers, durationSeconds = questionDurationSeconds) {
    const preparedPlayers = players.map((player, index) => ({
      id: `p${index + 1}`,
      name: player.name.trim().slice(0, 12) || `لاعب ${index + 1}`,
    }));
    try {
      localStorage.setItem('khotafha-players', JSON.stringify(preparedPlayers));
    } catch (error) {
      console.warn('تعذّر حفظ أسماء اللاعبين:', error);
    }
    setDraftPlayers(preparedPlayers);
    setPage('game');
    setClockNow(performance.now());
    dispatch({
      type: 'START',
      players: preparedPlayers,
      questions: makeRound(),
      durationMs: durationSeconds * 1000,
      now: performance.now(),
    });
  }

  function updatePlayerCount(count) {
    setDraftPlayers((existing) => Array.from({ length: count }, (_, index) => (
      existing[index] || { id: `p${index + 1}`, name: `لاعب ${index + 1}` }
    )));
  }

  function answer(player, optionIndex, pressedAt) {
    if (state.phase !== 'question' || state.responses[player.id]) return;
    const isCorrect = optionIndex === currentQuestion.correctIndex;
    playTone(isCorrect ? 'good' : 'bad', muted);
    dispatch({ type: 'ANSWER', playerId: player.id, optionIndex, pressedAt });
  }

  async function shareResults() {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext('2d');
    if (!context) {
      setNotice('مش قادرين نجهّز كارت النتيجة على الجهاز ده.');
      return;
    }
    context.fillStyle = '#183c30';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#e3ae45';
    context.beginPath();
    context.roundRect(40, 40, 1120, 550, 34);
    context.fill();
    context.fillStyle = '#183c30';
    context.textAlign = 'center';
    context.direction = 'rtl';
    context.font = '900 78px Cairo, sans-serif';
    context.fillText('خطفها!', 600, 145);
    context.font = '700 36px Cairo, sans-serif';
    context.fillText('مين إيده كانت الأسرع؟', 600, 205);
    context.font = '800 40px Cairo, sans-serif';
    ranking.slice(0, 4).forEach((player, index) => {
      context.fillText(
        `${index + 1}. ${player.name} — ${state.scores[player.id] ?? 0} نقطة`,
        600,
        300 + index * 62,
      );
    });
    context.font = '600 24px Cairo, sans-serif';
    context.fillText('جولة أصحاب.. من غير زعل 😄', 600, 535);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setNotice('حصلت مشكلة وإحنا بنجهّز الصورة.');
        return;
      }
      const file = new File([blob], 'khotafha-result.png', { type: 'image/png' });
      try {
        if (navigator.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({ title: 'نتيجة خطفها', text: 'مين إيده كانت الأسرع؟', files: [file] });
          setNotice('الكارت جاهز للمشاركة!');
          return;
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.warn('تعذّرت المشاركة المباشرة:', error);
      }
      const link = document.createElement('a');
      link.download = file.name;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice('نزّلنا كارت النتيجة.. ابعته لأصحابك!');
    }, 'image/png');
  }

  function backToSetup() {
    dispatch({ type: 'RETURN_TO_SETUP', players: draftPlayers });
    setPage('setup');
  }

  if (page === 'online') {
    return (
      <Suspense fallback={<main className="setup-shell"><p className="setup-hint">بنفتح باب الغرفة…</p></main>}>
        <OnlineRoom onBack={() => setPage('home')} />
      </Suspense>
    );
  }

  if (page === 'home') {
    return (
      <main className="home-shell">
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true">⚡</div>
          <span className="brand-name">خطفها</span>
          <button className="sound-toggle" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'شغّل الصوت' : 'اكتم الصوت'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </header>
        <section className="hero-panel">
          <div className="hero-kicker">لعبة السرعة.. واللمة الحلوة</div>
          <h1>إيدك أسرع<br /><span>ولا إيد صاحبك؟</span></h1>
          <p>أول ما السؤال يظهر.. اخطف الإجابة الصح قبل الباقيين!</p>
          <div className="hero-emoji" aria-hidden="true">🫖 ⚡ 🛺</div>
          <div className="home-actions">
            <button className="primary-button" type="button" onClick={() => setPage('setup')}>
              العب على جهاز واحد <span aria-hidden="true">←</span>
            </button>
            <button className="secondary-button" type="button" onClick={() => setPage('online')}>
              العب أونلاين <span className="coming-soon">غرفة أصحاب</span>
            </button>
          </div>
          <div className="hero-meta"><span>٢ لـ ٦ لاعبين</span><span>١٠ أسئلة سريعة</span><span>مفيش تسجيل</span></div>
        </section>
        <footer className="home-footer">قعدة أصحاب.. وخطفة من غير زعل 💛</footer>
      </main>
    );
  }

  if (page === 'setup') {
    return (
      <main className="setup-shell">
        <header className="topbar">
          <button className="back-button" type="button" onClick={() => setPage('home')}>← رجوع</button>
          <span className="brand-name">خطفها</span>
          <button className="sound-toggle" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'شغّل الصوت' : 'اكتم الصوت'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </header>
        <section className="setup-panel">
          <div className="section-kicker">قبل ما الخطف يبدأ</div>
          <h1>مين داخل التحدّي؟</h1>
          <label className="count-label" htmlFor="player-count">عدد اللاعبين</label>
          <div className="count-picker" id="player-count">
            {[2, 3, 4, 5, 6].map((count) => (
              <button
                className={draftPlayers.length === count ? 'count-option selected' : 'count-option'}
                key={count}
                type="button"
                aria-pressed={draftPlayers.length === count}
                onClick={() => updatePlayerCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <div className="name-list">
            {draftPlayers.map((player, index) => (
              <label className="name-field" key={player.id}>
                <span className="name-dot" style={{ backgroundColor: playerColors[index].color }} />
                <span>اللاعب {index + 1}</span>
                <input
                  aria-label={`اسم اللاعب ${index + 1}`}
                  maxLength={12}
                  value={player.name}
                  onChange={(event) => setDraftPlayers((players) => players.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, name: event.target.value } : item
                  )))}
                  placeholder={`لاعب ${index + 1}`}
                />
                <small>{player.name.length}/12</small>
              </label>
            ))}
          </div>
            <label className="duration-setting">
              <span>وقت كل سؤال</span>
              <select value={questionDurationSeconds} onChange={(event) => setQuestionDurationSeconds(Number(event.target.value))}>
                {[8, 12, 15, 20].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds} ثواني</option>
                ))}
              </select>
            </label>
            <p className="setup-hint">اقلبوا الجهاز بالعرض لو بتلعبوا اتنين.. وخلي كل واحد عند أزراره!</p>
          <button className="primary-button start-button" type="button" onClick={() => startRound()}>
            يلا نلعب <span aria-hidden="true">⚡</span>
          </button>
        </section>
      </main>
    );
  }

  if (state.phase === 'results') {
    return (
      <main className="results-shell">
        <header className="topbar">
          <span className="brand-name">خطفها</span>
          <button className="sound-toggle" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'شغّل الصوت' : 'اكتم الصوت'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </header>
        <section className="results-panel">
          <div className="winner-cup">🏆</div>
          <div className="section-kicker">خلصت الجولة.. عاش يا أبطال!</div>
          <h1>الترتيب النهائي</h1>
          <div className="ranking-list">
            {ranking.map((player, index) => (
              <div className={`rank-row ${index === 0 ? 'top-rank' : ''}`} key={player.id}>
                <span className="rank-number">{index === 0 ? '👑' : index + 1}</span>
                <span className="rank-name">{player.name}<small>{getTitle(index, ranking.length)}</small></span>
                <strong>{state.scores[player.id] ?? 0}<small>نقطة</small></strong>
              </div>
            ))}
          </div>
          <div className="results-actions">
            <button className="primary-button" type="button" onClick={() => startRound(state.players)}>جولة تانية <span>↻</span></button>
            <button className="secondary-button" type="button" onClick={shareResults}>شارك نتيجتك <span>↗</span></button>
          </div>
          <button className="text-button" type="button" onClick={backToSetup}>غيّر اللاعبين</button>
        </section>
        {notice && <div className="toast" role="status">{notice}</div>}
      </main>
    );
  }

  const remaining = state.deadline === null ? 0 : Math.max(0, state.deadline - clockNow);
  const questionProgress = state.phase === 'question' ? (remaining / state.durationMs) * 100 : 0;
  const countdownNumber = Math.max(1, Math.ceil(remaining / 1000));
  const currentResponses = Object.keys(state.responses).length;

  return (
    <main className={`game-shell ${state.players.length === 2 ? 'duel-mode' : 'crowd-mode'}`}>
      <header className="game-topbar">
        <div className="game-brand"><span>⚡</span> خطفها</div>
        <div className="round-counter">{state.phase === 'countdown' ? 'استعدوا!' : `السؤال ${state.questionIndex + 1} / ${QUESTION_COUNT}`}</div>
        <button className="sound-toggle game-sound" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'شغّل الصوت' : 'اكتم الصوت'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </header>

      {state.phase === 'countdown' ? (
        <section className="countdown-stage" aria-live="assertive">
          <p>خلي إيدك جاهزة!</p>
          <div className="countdown-number">{countdownNumber}</div>
          <span>ممنوع الخطف قبل ما السؤال يظهر 👀</span>
        </section>
      ) : (
        <>
          <section className={`question-stage ${state.phase === 'reveal' ? 'revealing' : ''}`}>
            <div className="question-meta">
              <span>{currentQuestion?.category}</span>
              <span>{state.phase === 'question' ? `جاوبوا بسرعة.. ${currentResponses}/${state.players.length}` : 'الإجابة كانت'}</span>
            </div>
            <div className="question-word" key={currentQuestion?.id}>
              {state.phase === 'reveal' ? currentQuestion?.emoji : currentQuestion?.emoji}
              <strong>{currentQuestion?.text}</strong>
            </div>
            {state.phase === 'question' ? (
              <div className="timer-track" role="progressbar" aria-label="الوقت المتبقي" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(questionProgress)}>
                <div className="timer-fill" style={{ width: `${questionProgress}%` }} />
              </div>
            ) : (
              <div className="reveal-message" aria-live="polite">
                <strong>{state.reveal?.correctAnswer}</strong>
                {state.reveal?.winnerId
                  ? <span>خطفها {state.players.find((player) => player.id === state.reveal.winnerId)?.name} ⚡</span>
                  : <span>محدش لحقها المرة دي!</span>}
              </div>
            )}
          </section>

          {state.players.length === 2 ? (
            <section className="duel-players" aria-label="أزرار اللاعبين">
              {[state.players[0], state.players[1]].map((player, index) => (
                <PlayerPad
                  key={player.id}
                  player={player}
                  index={index}
                  question={currentQuestion}
                  response={state.responses[player.id]}
                  revealed={state.phase === 'reveal'}
                  score={state.scores[player.id] ?? 0}
                  disabled={state.phase !== 'question'}
                  onAnswer={(optionIndex, pressedAt) => answer(player, optionIndex, pressedAt)}
                />
              ))}
            </section>
          ) : (
            <section className="crowd-players" aria-label="أزرار اللاعبين">
              {state.players.map((player, index) => (
                <PlayerPad
                  key={player.id}
                  player={player}
                  index={index}
                  question={currentQuestion}
                  response={state.responses[player.id]}
                  revealed={state.phase === 'reveal'}
                  score={state.scores[player.id] ?? 0}
                  disabled={state.phase !== 'question'}
                  onAnswer={(optionIndex, pressedAt) => answer(player, optionIndex, pressedAt)}
                />
              ))}
            </section>
          )}
        </>
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function PlayerPad({ player, index, question, response, revealed, score, disabled, onAnswer }) {
  const palette = playerColors[index];
  return (
    <section
      className={`player-pad player-${index + 1} ${response ? (response.correct ? 'player-correct' : 'player-wrong') : ''} ${disabled ? 'pad-disabled' : ''}`}
      style={{ '--player-color': palette.color, '--player-ink': palette.dark }}
      aria-label={`إجابات ${player.name}`}
    >
      <div className="player-heading">
        <span className="player-name">{player.name}</span>
        <span className="player-score">{score} نقطة</span>
        {response && <span className="answer-status">{response.correct ? 'خطفها! ⚡' : 'اتقفلت عليك!'}</span>}
      </div>
      <div className="answer-grid">
        {question?.options.map((option, optionIndex) => {
          const correctAnswer = question.correctIndex === optionIndex;
          const selected = response?.optionIndex === optionIndex;
          const answerClass = selected && response.correct
            ? 'answer-correct'
            : selected && !response.correct
              ? 'answer-wrong'
              : revealed && correctAnswer ? 'answer-correct' : '';
          const marker = selected
            ? response.correct ? '✓ صح' : '✕ غلط'
            : revealed && correctAnswer ? '✓ الصح' : '';
          return (
            <button
              className={`answer-button ${answerClass}`}
              key={`${question.id}-${optionIndex}`}
              type="button"
              aria-pressed={selected}
              disabled={disabled || Boolean(response)}
              onPointerDown={(event) => {
                event.preventDefault();
                if (!event.isPrimary && event.pointerType === 'mouse') return;
                onAnswer(optionIndex, performance.now());
              }}
            >
              <span className="option-letter">{['أ', 'ب', 'ج', 'د'][optionIndex]}</span>
              <span>{option}</span>
              {marker && <span className="answer-marker">{marker}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default App;
