export const QUESTION_COUNT = 10;
export const QUESTION_DURATION_MS = 12000;
export const REVEAL_DURATION_MS = 1000;
export const COUNTDOWN_DURATION_MS = 3000;

export function createInitialState(players = []) {
  return {
    phase: 'setup',
    players,
    questions: [],
    questionIndex: -1,
    scores: {},
    responses: {},
    reveal: null,
    deadline: null,
    durationMs: QUESTION_DURATION_MS,
  };
}

function awardAndReveal(state, now) {
  const question = state.questions[state.questionIndex];
  const responses = Object.values(state.responses);
  const correct = responses
    .filter((response) => response.correct)
    .sort((a, b) => a.pressedAt - b.pressedAt);
  const scores = { ...state.scores };
  responses.filter((response) => !response.correct).forEach((response) => {
    scores[response.playerId] = (scores[response.playerId] ?? 0) - 3;
  });
  correct.forEach((response, index) => {
    scores[response.playerId] = (scores[response.playerId] ?? 0) + ([10, 6, 4, 2][index] ?? 2);
  });

  return {
    ...state,
    phase: 'reveal',
    scores,
    deadline: now + REVEAL_DURATION_MS,
    reveal: {
      correctAnswer: question.options[question.correctIndex],
      winnerId: correct[0]?.playerId ?? null,
      correctPlayerIds: correct.map((response) => response.playerId),
      wrongPlayerIds: responses.filter((response) => !response.correct).map((response) => response.playerId),
    },
  };
}

function beginQuestion(state, questionIndex, now) {
  return {
    ...state,
    phase: 'question',
    questionIndex,
    responses: {},
    reveal: null,
    deadline: now + state.durationMs,
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'SET_PLAYERS':
      return state.phase === 'setup' ? { ...state, players: action.players } : state;
    case 'START':
      return {
        ...state,
        phase: 'countdown',
        players: action.players,
        questions: action.questions,
        questionIndex: -1,
        scores: Object.fromEntries(action.players.map((player) => [player.id, 0])),
        responses: {},
        reveal: null,
        deadline: action.now + COUNTDOWN_DURATION_MS,
        durationMs: action.durationMs ?? QUESTION_DURATION_MS,
      };
    case 'ANSWER': {
      if (state.phase !== 'question' || state.responses[action.playerId]) return state;
      if (action.pressedAt >= state.deadline) return awardAndReveal(state, action.pressedAt);
      const question = state.questions[state.questionIndex];
      const response = {
        playerId: action.playerId,
        optionIndex: action.optionIndex,
        correct: action.optionIndex === question.correctIndex,
        pressedAt: action.pressedAt,
      };
      const responses = { ...state.responses, [action.playerId]: response };
      const nextState = { ...state, responses };
      return Object.keys(responses).length === state.players.length
        ? awardAndReveal(nextState, action.pressedAt)
        : nextState;
    }
    case 'TICK': {
      if (state.deadline === null || action.now < state.deadline) return state;
      if (state.phase === 'countdown') return beginQuestion(state, 0, action.now);
      if (state.phase === 'question') return awardAndReveal(state, action.now);
      if (state.phase === 'reveal') {
        const nextIndex = state.questionIndex + 1;
        return nextIndex >= state.questions.length
          ? { ...state, phase: 'results', deadline: null }
          : beginQuestion(state, nextIndex, action.now);
      }
      return state;
    }
    case 'RETURN_TO_SETUP':
      return createInitialState(action.players);
    default:
      return state;
  }
}
