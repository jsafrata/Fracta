// ─── Game Constants ──────────────────────────────────────────────
export const NUM_PLAYERS = 4;
export const NUM_COMMODITIES = 5;
export const NUM_TICKS = 30;
export const TICK_DURATION = 5000; // ms
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
    pendingQuotes: {}, // posted this tick, visible next tick
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

  // Move pending quotes to visible book
  for (const [id, quote] of Object.entries(s.pendingQuotes)) {
    s.orderBook[id] = quote;
  }
  s.pendingQuotes = {};

  // 1. Process accepts first
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

  // 3. Process new posts (go to pending)
  for (let i = 0; i < NUM_PLAYERS; i++) {
    const action = actions[i];
    if (!action) continue;

    if (action.type === ActionType.POST_BID) {
      const { commodity, price } = action;
      if (price < PRICE_MIN || price > PRICE_MAX) continue;
      if (s.cash[i] < price) continue;

      // Remove old bid
      if (s.activeBids[i] != null) {
        delete s.orderBook[s.activeBids[i]];
        delete s.pendingQuotes[s.activeBids[i]];
      }

      const id = s.nextQuoteId++;
      const quote = { id, player: i, side: 'bid', commodity, price, tick: s.tick };
      s.pendingQuotes[id] = quote;
      s.activeBids[i] = id;
    }

    if (action.type === ActionType.POST_ASK) {
      const { commodity, price } = action;
      if (price < PRICE_MIN || price > PRICE_MAX) continue;
      if (s.inventories[i][commodity] < 1) continue;

      // Remove old ask
      if (s.activeAsks[i] != null) {
        delete s.orderBook[s.activeAsks[i]];
        delete s.pendingQuotes[s.activeAsks[i]];
      }

      const id = s.nextQuoteId++;
      const quote = { id, player: i, side: 'ask', commodity, price, tick: s.tick };
      s.pendingQuotes[id] = quote;
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
export function generateBotAction(state, botId) {
  const view = getPlayerView(state, botId);
  const { cash, inventory, knownValues, orderBook } = view;

  // Estimate values: known exactly, unknown = expected value (5.5)
  const estimated = Array.from({ length: NUM_COMMODITIES }, (_, j) =>
    knownValues[j] !== undefined ? knownValues[j] : 5.5
  );

  // Collect visible quotes from other players
  const quotes = Object.values(orderBook).filter((q) => q.player !== botId);
  const asks = quotes.filter((q) => q.side === 'ask');
  const bids = quotes.filter((q) => q.side === 'bid');

  // Find best deal to accept
  let bestAccept = null;
  let bestProfit = 0;

  // Check asks to buy (profitable if ask price < estimated value)
  for (const ask of asks) {
    const profit = estimated[ask.commodity] - ask.price;
    if (profit > bestProfit && cash >= ask.price) {
      bestProfit = profit;
      bestAccept = { type: ActionType.ACCEPT, quoteId: ask.id };
    }
  }

  // Check bids to sell (profitable if bid price > estimated value)
  for (const bid of bids) {
    const profit = bid.price - estimated[bid.commodity];
    if (profit > bestProfit && inventory[bid.commodity] > 0) {
      bestProfit = profit;
      bestAccept = { type: ActionType.ACCEPT, quoteId: bid.id };
    }
  }

  // If there's a good deal (profit > 1), take it with high probability
  if (bestAccept && bestProfit > 1 && Math.random() < 0.8) {
    return bestAccept;
  }
  if (bestAccept && bestProfit > 0 && Math.random() < 0.5) {
    return bestAccept;
  }

  // Otherwise, consider posting quotes
  if (Math.random() < 0.3) {
    return { type: ActionType.NOTHING };
  }

  // Pick a random commodity to quote on
  const j = Math.floor(Math.random() * NUM_COMMODITIES);
  const ev = estimated[j];

  // Spread depends on certainty
  const isKnown = knownValues[j] !== undefined;
  const spread = isKnown ? randInt(1, 2) : randInt(2, 4);

  if (Math.random() < 0.5) {
    // Post bid
    const bidPrice = Math.max(PRICE_MIN, Math.round(ev - spread / 2 + (Math.random() - 0.5) * 2));
    if (bidPrice >= PRICE_MIN && bidPrice <= PRICE_MAX && cash >= bidPrice) {
      return { type: ActionType.POST_BID, commodity: j, price: bidPrice };
    }
  } else {
    // Post ask
    const askPrice = Math.min(PRICE_MAX, Math.round(ev + spread / 2 + (Math.random() - 0.5) * 2));
    if (askPrice >= PRICE_MIN && askPrice <= PRICE_MAX && inventory[j] > 0) {
      return { type: ActionType.POST_ASK, commodity: j, price: askPrice };
    }
  }

  return { type: ActionType.NOTHING };
}
