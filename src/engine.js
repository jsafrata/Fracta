// ─── Game Constants ──────────────────────────────────────────────
export const NUM_PLAYERS = 4;
export const NUM_COMMODITIES = 5;
export const NUM_TICKS = 30;
export const TICK_DURATION = 10000; // ms
export const PREP_DURATION = 10000; // ms — pre-game scan window
export const STARTING_CASH = 100;
export const CARDS_PER_PLAYER = 10;
export const CARDS_PER_COMMODITY_TOTAL = 8; // across all players
export const VALUE_MIN = 1;
export const VALUE_MAX = 10;
export const PRICE_MIN = 1;
export const PRICE_MAX = 20;

export const COMMODITY_NAMES = ['Gold', 'Silver', 'Oil', 'Wheat', 'Copper'];
export const COMMODITY_COLORS = ['#ffd700', '#c0c0c0', '#2dd4bf', '#f59e0b', '#f97316'];
export const PLAYER_NAMES = ['You', 'Bot α', 'Bot β', 'Bot γ'];

// ─── Information Set Templates ───────────────────────────────────
const INFO_TEMPLATES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
];

// ─── Utility ─────────────────────────────────────────────────────
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Hand Generation ─────────────────────────────────────────────
// Generates fair starting hands with equal value for all players.
// Strategy: build a deck, deal cards, then swap to equalize values.
function generateHands(values) {
  // Build deck: CARDS_PER_COMMODITY_TOTAL of each type
  const deck = [];
  for (let j = 0; j < NUM_COMMODITIES; j++) {
    for (let k = 0; k < CARDS_PER_COMMODITY_TOTAL; k++) {
      deck.push(j);
    }
  }
  // Total cards = 40, 10 per player
  const shuffled = shuffle(deck);

  const hands = Array.from({ length: NUM_PLAYERS }, () =>
    Array(NUM_COMMODITIES).fill(0)
  );

  // Deal
  for (let i = 0; i < NUM_PLAYERS; i++) {
    for (let k = 0; k < CARDS_PER_PLAYER; k++) {
      const card = shuffled[i * CARDS_PER_PLAYER + k];
      hands[i][card]++;
    }
  }

  // Calculate hand values
  const handValue = (hand) => hand.reduce((s, cnt, j) => s + cnt * values[j], 0);

  // Swap to equalize: iterate and swap cards between richest and poorest
  for (let iter = 0; iter < 200; iter++) {
    const vals = hands.map(handValue);
    const maxI = vals.indexOf(Math.max(...vals));
    const minI = vals.indexOf(Math.min(...vals));
    if (vals[maxI] - vals[minI] <= 0) break;

    // Try to find a beneficial swap
    let swapped = false;
    for (let j1 = 0; j1 < NUM_COMMODITIES && !swapped; j1++) {
      for (let j2 = 0; j2 < NUM_COMMODITIES && !swapped; j2++) {
        if (j1 === j2) continue;
        if (values[j1] <= values[j2]) continue; // j1 is more valuable
        if (hands[maxI][j1] > 0 && hands[minI][j2] > 0) {
          const delta = values[j1] - values[j2];
          const gap = vals[maxI] - vals[minI];
          if (delta <= gap) {
            hands[maxI][j1]--;
            hands[maxI][j2]++;
            hands[minI][j1]++;
            hands[minI][j2]--;
            swapped = true;
          }
        }
      }
    }
    if (!swapped) break;
  }

  return hands;
}

// ─── Initialize Game ─────────────────────────────────────────────
export function initializeGame() {
  const values = Array.from({ length: NUM_COMMODITIES }, () =>
    randInt(VALUE_MIN, VALUE_MAX)
  );

  // Rotate info sets randomly
  const offset = randInt(0, NUM_COMMODITIES - 1);
  const infoSets = INFO_TEMPLATES.map((set) =>
    set.map((j) => (j + offset) % NUM_COMMODITIES)
  );

  const hands = generateHands(values);

  // Cash adjustment: make total wealth equal
  // Total wealth = cash + hand value
  const handValues = hands.map((h) =>
    h.reduce((s, cnt, j) => s + cnt * values[j], 0)
  );
  const maxHV = Math.max(...handValues);
  const cash = handValues.map((hv) => STARTING_CASH + (maxHV - hv));
  // Now everyone has cash[i] + handValues[i] = STARTING_CASH + maxHV

  return {
    values,
    infoSets,
    inventories: hands,
    cash,
    orderBook: {}, // id -> { id, player, side, commodity, price, tick }
    tick: 0,
    tradeLog: [],
    nextQuoteId: 1,
    activeBids: Array(NUM_PLAYERS).fill(null), // quote id per player
    activeAsks: Array(NUM_PLAYERS).fill(null),
    gameOver: false,
    scores: null,
  };
}

// ─── Player Observation ──────────────────────────────────────────
export function getPlayerView(state, playerId) {
  const knownValues = {};
  state.infoSets[playerId].forEach((j) => {
    knownValues[j] = state.values[j];
  });

  return {
    playerId,
    tick: state.tick,
    cash: state.cash[playerId],
    inventory: [...state.inventories[playerId]],
    knownValues,
    infoSet: [...state.infoSets[playerId]],
    orderBook: { ...state.orderBook },
    tradeLog: state.tradeLog,
    activeBid: state.activeBids[playerId],
    activeAsk: state.activeAsks[playerId],
    gameOver: state.gameOver,
    scores: state.scores,
    allCash: [...state.cash],
    allInventories: state.gameOver ? state.inventories.map((inv) => [...inv]) : null,
    values: state.gameOver ? [...state.values] : null,
  };
}

// ─── Action Types ────────────────────────────────────────────────
export const ActionType = {
  NOTHING: 'nothing',
  POST_BID: 'post_bid',
  POST_ASK: 'post_ask',
  ACCEPT: 'accept',
  CANCEL_BID: 'cancel_bid',
  CANCEL_ASK: 'cancel_ask',
};

// ─── Process Actions ─────────────────────────────────────────────
export function processActions(state, actions) {
  // Deep copy state
  const s = JSON.parse(JSON.stringify(state));

  // 1. Process accepts first (against book from start of tick — posts made
  //    this tick land in step 3 below and can only be accepted next tick)
  const acceptMap = {}; // quoteId -> [playerId, ...]
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const action = actions[i];
    if (!action || action.type !== ActionType.ACCEPT) continue;
    const qid = action.quoteId;
    if (!s.orderBook[qid]) continue;

    const quote = s.orderBook[qid];
    // Can't accept your own quote
    if (quote.player === i) continue;

    // Check if player can afford / has the unit
    if (quote.side === 'ask') {
      // Player i is buying
      if (s.cash[i] < quote.price) continue;
    } else {
      // Player i is selling
      if (s.inventories[i][quote.commodity] < 1) continue;
    }

    if (!acceptMap[qid]) acceptMap[qid] = [];
    acceptMap[qid].push(i);
  }

  // Resolve accepts (random selection if multiple)
  for (const [qid, players] of Object.entries(acceptMap)) {
    const quote = s.orderBook[qid];
    if (!quote) continue;

    // Verify poster still has resources
    if (quote.side === 'ask') {
      if (s.inventories[quote.player][quote.commodity] < 1) continue;
    } else {
      if (s.cash[quote.player] < quote.price) continue;
    }

    const winner = players[Math.floor(Math.random() * players.length)];

    // Re-verify winner can still trade
    if (quote.side === 'ask') {
      if (s.cash[winner] < quote.price) continue;
      // Winner buys from poster
      s.cash[winner] -= quote.price;
      s.cash[quote.player] += quote.price;
      s.inventories[winner][quote.commodity]++;
      s.inventories[quote.player][quote.commodity]--;
      s.tradeLog.push({
        tick: s.tick,
        buyer: winner,
        seller: quote.player,
        commodity: quote.commodity,
        price: quote.price,
      });
    } else {
      if (s.inventories[winner][quote.commodity] < 1) continue;
      // Winner sells to poster (who is bidding)
      s.cash[winner] += quote.price;
      s.cash[quote.player] -= quote.price;
      s.inventories[winner][quote.commodity]--;
      s.inventories[quote.player][quote.commodity]++;
      s.tradeLog.push({
        tick: s.tick,
        buyer: quote.player,
        seller: winner,
        commodity: quote.commodity,
        price: quote.price,
      });
    }

    // Remove executed quote
    delete s.orderBook[qid];
    if (s.activeBids[quote.player] === parseInt(qid))
      s.activeBids[quote.player] = null;
    if (s.activeAsks[quote.player] === parseInt(qid))
      s.activeAsks[quote.player] = null;
  }

  // 2. Process cancels
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const action = actions[i];
    if (!action) continue;
    if (action.type === ActionType.CANCEL_BID && s.activeBids[i] != null) {
      delete s.orderBook[s.activeBids[i]];
      s.activeBids[i] = null;
    }
    if (action.type === ActionType.CANCEL_ASK && s.activeAsks[i] != null) {
      delete s.orderBook[s.activeAsks[i]];
      s.activeAsks[i] = null;
    }
  }

  // 3. Process new posts — visible in next tick's view
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const action = actions[i];
    if (!action) continue;

    if (action.type === ActionType.POST_BID) {
      const { commodity, price } = action;
      if (price < PRICE_MIN || price > PRICE_MAX) continue;
      if (s.cash[i] < price) continue;

      if (s.activeBids[i] != null) {
        delete s.orderBook[s.activeBids[i]];
      }

      const id = s.nextQuoteId++;
      const quote = { id, player: i, side: 'bid', commodity, price, tick: s.tick };
      s.orderBook[id] = quote;
      s.activeBids[i] = id;
    }

    if (action.type === ActionType.POST_ASK) {
      const { commodity, price } = action;
      if (price < PRICE_MIN || price > PRICE_MAX) continue;
      if (s.inventories[i][commodity] < 1) continue;

      if (s.activeAsks[i] != null) {
        delete s.orderBook[s.activeAsks[i]];
      }

      const id = s.nextQuoteId++;
      const quote = { id, player: i, side: 'ask', commodity, price, tick: s.tick };
      s.orderBook[id] = quote;
      s.activeAsks[i] = id;
    }
  }

  // Clean up stale quotes (poster no longer has resources)
  for (const [id, quote] of Object.entries(s.orderBook)) {
    if (quote.side === 'ask' && s.inventories[quote.player][quote.commodity] < 1) {
      delete s.orderBook[id];
      if (s.activeAsks[quote.player] === parseInt(id)) s.activeAsks[quote.player] = null;
    }
    if (quote.side === 'bid' && s.cash[quote.player] < quote.price) {
      delete s.orderBook[id];
      if (s.activeBids[quote.player] === parseInt(id)) s.activeBids[quote.player] = null;
    }
  }

  // Advance tick
  s.tick++;

  // Check game over
  if (s.tick >= NUM_TICKS) {
    s.gameOver = true;
    s.scores = s.cash.map((c, i) =>
      c + s.inventories[i].reduce((sum, cnt, j) => sum + cnt * s.values[j], 0)
    );
  }

  return s;
}

// ─── Bot AI ──────────────────────────────────────────────────────
// Three distinct personalities (indexed by botId 1/2/3):
//   1 — α Maker:     posts tight quotes often, accepts only clear edges
//   2 — β Taker:     rarely posts, snaps up any profitable quote fast
//   3 — γ Inferrer:  weights trade history heavily, balanced post/take
const BOT_PROFILES = {
  1: { acceptThreshold: 1.5, acceptProb: 0.7, postProb: 0.6, spreadMult: 1.0, inferenceWeight: 0.5 },
  2: { acceptThreshold: 0.4, acceptProb: 0.95, postProb: 0.2, spreadMult: 0.6, inferenceWeight: 0.7 },
  3: { acceptThreshold: 1.0, acceptProb: 0.8, postProb: 0.45, spreadMult: 0.9, inferenceWeight: 1.0 },
};

// Refine unknown-commodity value estimates using recent trade prices.
// Known values pin at truth; unknowns blend the 5.5 prior with observed trades.
function estimateCommodityValues(view, inferenceWeight) {
  const { knownValues, tradeLog } = view;
  const estimated = Array(NUM_COMMODITIES).fill(0);
  const confidence = Array(NUM_COMMODITIES).fill(0);

  for (let j = 0; j < NUM_COMMODITIES; j++) {
    if (knownValues[j] !== undefined) {
      estimated[j] = knownValues[j];
      confidence[j] = 1.0;
      continue;
    }
    const recent = tradeLog.slice(-30).filter((t) => t.commodity === j);
    if (recent.length === 0) {
      estimated[j] = 5.5;
      confidence[j] = 0.0;
      continue;
    }
    const avg = recent.reduce((s, t) => s + t.price, 0) / recent.length;
    // Blend 5.5 prior with observed avg; weight scales with sample size × profile
    const w = Math.min((recent.length / 4) * inferenceWeight, 0.85);
    estimated[j] = 5.5 * (1 - w) + avg * w;
    confidence[j] = w;
  }
  return { estimated, confidence };
}

export function generateBotAction(state, botId) {
  const view = getPlayerView(state, botId);
  const { cash, inventory, orderBook } = view;
  const profile = BOT_PROFILES[botId] || BOT_PROFILES[1];
  const { estimated, confidence } = estimateCommodityValues(view, profile.inferenceWeight);

  // Scan visible quotes
  const quotes = Object.values(orderBook).filter((q) => q.player !== botId);
  let bestAccept = null;
  let bestProfit = 0;

  for (const q of quotes) {
    if (q.side === 'ask') {
      const profit = estimated[q.commodity] - q.price;
      if (profit > bestProfit && cash >= q.price) {
        bestProfit = profit;
        bestAccept = { type: ActionType.ACCEPT, quoteId: q.id };
      }
    } else {
      const profit = q.price - estimated[q.commodity];
      if (profit > bestProfit && inventory[q.commodity] > 0) {
        bestProfit = profit;
        bestAccept = { type: ActionType.ACCEPT, quoteId: q.id };
      }
    }
  }

  if (bestAccept && bestProfit >= profile.acceptThreshold && Math.random() < profile.acceptProb) {
    return bestAccept;
  }
  if (bestAccept && bestProfit > 0 && Math.random() < profile.acceptProb * 0.35) {
    return bestAccept;
  }

  // Maybe post a quote
  if (Math.random() > profile.postProb) {
    return { type: ActionType.NOTHING };
  }

  // Prefer commodities the bot has strong opinions on (known or well-inferred)
  const weights = confidence.map((c) => 0.2 + c);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let j = 0;
  for (; j < NUM_COMMODITIES - 1; j++) {
    r -= weights[j];
    if (r <= 0) break;
  }

  const ev = estimated[j];
  // Wider spread when uncertain; profile scales overall tightness
  const baseSpread = (1 + (1 - confidence[j]) * 3) * profile.spreadMult;
  const jitter = (Math.random() - 0.5) * 1.2;

  // Inventory pressure: skew toward selling when holding many, buying when few
  const holding = inventory[j];
  const sellBias = holding >= 3 ? 0.7 : holding === 0 ? 0.0 : 0.5;

  if (Math.random() < sellBias && holding > 0) {
    const askPrice = Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(ev + baseSpread / 2 + jitter)));
    return { type: ActionType.POST_ASK, commodity: j, price: askPrice };
  } else {
    const bidPrice = Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(ev - baseSpread / 2 + jitter)));
    if (cash >= bidPrice) {
      return { type: ActionType.POST_BID, commodity: j, price: bidPrice };
    }
  }

  return { type: ActionType.NOTHING };
}
