import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  initializeGame,
  getPlayerView,
  processActions,
  generateBotAction,
  ActionType,
  NUM_PLAYERS,
  NUM_COMMODITIES,
  NUM_TICKS,
  TICK_DURATION,
  PRICE_MIN,
  PRICE_MAX,
  COMMODITY_NAMES,
  COMMODITY_COLORS,
  PLAYER_NAMES,
} from './engine';

// ─── Helpers ─────────────────────────────────────────────────────
function formatCash(n) {
  return '$' + n.toFixed(0);
}

// ─── Start Screen ────────────────────────────────────────────────
function StartScreen({ onStart }) {
  return (
    <div className="start-screen">
      <div className="start-content">
        <div className="start-logo">⬡</div>
        <h1 className="start-title">COMMODITY EXCHANGE</h1>
        <p className="start-subtitle">
          A 4-player information-asymmetry trading game
        </p>
        <div className="start-rules">
          <div className="rule-item">
            <span className="rule-icon">◈</span>
            <span>5 commodities with hidden terminal values (1–10)</span>
          </div>
          <div className="rule-item">
            <span className="rule-icon">◈</span>
            <span>You know exactly 2 commodity values. Others know different pairs.</span>
          </div>
          <div className="rule-item">
            <span className="rule-icon">◈</span>
            <span>Trade via bids, asks, and accepting quotes on the order book</span>
          </div>
          <div className="rule-item">
            <span className="rule-icon">◈</span>
            <span>30 ticks × 5 seconds. Maximize cash + liquidation value.</span>
          </div>
        </div>
        <button className="start-btn" onClick={onStart}>
          START TRADING
        </button>
      </div>
    </div>
  );
}

// ─── Game Over Screen ────────────────────────────────────────────
function GameOverScreen({ view, onRestart }) {
  const { scores, values } = view;
  const sorted = scores
    .map((s, i) => ({ player: i, score: s }))
    .sort((a, b) => b.score - a.score);
  const playerRank = sorted.findIndex((s) => s.player === 0) + 1;

  return (
    <div className="gameover-overlay">
      <div className="gameover-card">
        <h2 className="gameover-title">MARKET CLOSED</h2>
        <div className="gameover-values">
          <p className="gameover-label">True Commodity Values</p>
          <div className="value-chips">
            {COMMODITY_NAMES.map((name, j) => (
              <span
                key={j}
                className="value-chip"
                style={{ borderColor: COMMODITY_COLORS[j] }}
              >
                {name}: <strong>${values[j]}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="gameover-rankings">
          {sorted.map((s, rank) => (
            <div
              key={s.player}
              className={`rank-row ${s.player === 0 ? 'rank-you' : ''}`}
            >
              <span className="rank-num">#{rank + 1}</span>
              <span className="rank-name">{PLAYER_NAMES[s.player]}</span>
              <span className="rank-score">{formatCash(s.score)}</span>
            </div>
          ))}
        </div>
        <p className="gameover-result">
          {playerRank === 1
            ? '🏆 You won!'
            : playerRank === 2
            ? 'Close — 2nd place!'
            : `You placed #${playerRank}`}
        </p>
        <button className="start-btn" onClick={onRestart}>
          PLAY AGAIN
        </button>
      </div>
    </div>
  );
}

// ─── Order Book Display ──────────────────────────────────────────
function OrderBookDisplay({ orderBook, commodity, onAccept }) {
  const quotes = Object.values(orderBook).filter(
    (q) => q.commodity === commodity
  );
  const bids = quotes
    .filter((q) => q.side === 'bid')
    .sort((a, b) => b.price - a.price);
  const asks = quotes
    .filter((q) => q.side === 'ask')
    .sort((a, b) => a.price - b.price);

  return (
    <div className="order-book">
      <div className="ob-side ob-bids">
        <div className="ob-header">BIDS</div>
        {bids.length === 0 ? (
          <div className="ob-empty">—</div>
        ) : (
          bids.map((q) => (
            <div key={q.id} className="ob-row bid-row">
              <span className="ob-price">${q.price}</span>
              <span className="ob-player">
                {PLAYER_NAMES[q.player].substring(0, 5)}
              </span>
              {q.player !== 0 && (
                <button
                  className="ob-accept-btn sell-btn-sm"
                  onClick={() => onAccept(q.id)}
                  title="Sell to this bidder"
                >
                  SELL
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="ob-side ob-asks">
        <div className="ob-header">ASKS</div>
        {asks.length === 0 ? (
          <div className="ob-empty">—</div>
        ) : (
          asks.map((q) => (
            <div key={q.id} className="ob-row ask-row">
              <span className="ob-price">${q.price}</span>
              <span className="ob-player">
                {PLAYER_NAMES[q.player].substring(0, 5)}
              </span>
              {q.player !== 0 && (
                <button
                  className="ob-accept-btn buy-btn-sm"
                  onClick={() => onAccept(q.id)}
                  title="Buy from this seller"
                >
                  BUY
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Commodity Panel ─────────────────────────────────────────────
function CommodityPanel({
  index,
  view,
  pendingAction,
  onPostBid,
  onPostAsk,
  onAccept,
  onCancel,
}) {
  const [bidPrice, setBidPrice] = useState('');
  const [askPrice, setAskPrice] = useState('');
  const name = COMMODITY_NAMES[index];
  const color = COMMODITY_COLORS[index];
  const known = view.knownValues[index];
  const holding = view.inventory[index];

  const myBidQuote =
    view.activeBid != null ? view.orderBook[view.activeBid] : null;
  const myAskQuote =
    view.activeAsk != null ? view.orderBook[view.activeAsk] : null;

  const hasBidOnThis =
    myBidQuote && myBidQuote.commodity === index;
  const hasAskOnThis =
    myAskQuote && myAskQuote.commodity === index;

  return (
    <div className="commodity-panel" style={{ '--accent': color }}>
      <div className="cp-header">
        <span className="cp-dot" style={{ background: color }} />
        <span className="cp-name">{name}</span>
        {known !== undefined ? (
          <span className="cp-value known">Value: ${known}</span>
        ) : (
          <span className="cp-value unknown">Value: ???</span>
        )}
      </div>

      <div className="cp-holding">
        <span>Holdings:</span>
        <span className="cp-holding-num">{holding} units</span>
      </div>

      <OrderBookDisplay
        orderBook={view.orderBook}
        commodity={index}
        onAccept={onAccept}
      />

      <div className="cp-actions">
        <div className="cp-action-row">
          <div className="cp-input-group bid-group">
            <input
              type="number"
              min={PRICE_MIN}
              max={PRICE_MAX}
              placeholder="Bid $"
              value={bidPrice}
              onChange={(e) => setBidPrice(e.target.value)}
              className="cp-input"
            />
            <button
              className="cp-btn bid-btn"
              onClick={() => {
                const p = parseInt(bidPrice);
                if (p >= PRICE_MIN && p <= PRICE_MAX) {
                  onPostBid(index, p);
                  setBidPrice('');
                }
              }}
              disabled={view.gameOver}
            >
              POST BID
            </button>
          </div>
          <div className="cp-input-group ask-group">
            <input
              type="number"
              min={PRICE_MIN}
              max={PRICE_MAX}
              placeholder="Ask $"
              value={askPrice}
              onChange={(e) => setAskPrice(e.target.value)}
              className="cp-input"
            />
            <button
              className="cp-btn ask-btn"
              onClick={() => {
                const p = parseInt(askPrice);
                if (p >= PRICE_MIN && p <= PRICE_MAX) {
                  onPostAsk(index, p);
                  setAskPrice('');
                }
              }}
              disabled={view.gameOver || holding < 1}
            >
              POST ASK
            </button>
          </div>
        </div>

        {(hasBidOnThis || hasAskOnThis) && (
          <div className="cp-active-quotes">
            {hasBidOnThis && (
              <div className="active-quote bid-active">
                Your bid: ${myBidQuote.price}
                <button
                  className="cancel-btn"
                  onClick={() => onCancel('bid')}
                >
                  ✕
                </button>
              </div>
            )}
            {hasAskOnThis && (
              <div className="active-quote ask-active">
                Your ask: ${myAskQuote.price}
                <button
                  className="cancel-btn"
                  onClick={() => onCancel('ask')}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {pendingAction && pendingAction.commodity === index && (
        <div className="cp-pending">
          Queued: {pendingAction.type.replace('_', ' ')}
          {pendingAction.price != null && ` @ $${pendingAction.price}`}
        </div>
      )}
    </div>
  );
}

// ─── Trade Log ───────────────────────────────────────────────────
function TradeLog({ log }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  if (log.length === 0)
    return <div className="trade-log-empty">No trades yet</div>;

  return (
    <div className="trade-log">
      {log
        .slice()
        .reverse()
        .slice(0, 30)
        .map((t, i) => (
          <div key={i} className="tl-entry">
            <span className="tl-tick">T{t.tick}</span>
            <span className="tl-comm" style={{ color: COMMODITY_COLORS[t.commodity] }}>
              {COMMODITY_NAMES[t.commodity]}
            </span>
            <span className="tl-price">${t.price}</span>
            <span className="tl-parties">
              {PLAYER_NAMES[t.buyer]} ← {PLAYER_NAMES[t.seller]}
            </span>
          </div>
        ))}
      <div ref={endRef} />
    </div>
  );
}

// ─── Info Bar ────────────────────────────────────────────────────
function InfoBar({ view, timeLeft, totalWealth }) {
  return (
    <div className="info-bar">
      <div className="ib-section">
        <span className="ib-label">TICK</span>
        <span className="ib-value">
          {view.tick} / {NUM_TICKS}
        </span>
      </div>
      <div className="ib-section">
        <span className="ib-label">TIME</span>
        <span className={`ib-value ${timeLeft <= 2 ? 'ib-urgent' : ''}`}>
          {timeLeft.toFixed(1)}s
        </span>
      </div>
      <div className="ib-section">
        <span className="ib-label">CASH</span>
        <span className="ib-value ib-cash">{formatCash(view.cash)}</span>
      </div>
      <div className="ib-section">
        <span className="ib-label">EST. WEALTH</span>
        <span className="ib-value ib-wealth">{formatCash(totalWealth)}</span>
      </div>
      <div className="ib-timer-bar">
        <div
          className="ib-timer-fill"
          style={{ width: `${(timeLeft / (TICK_DURATION / 1000)) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ─── Player Summary (other players) ─────────────────────────────
function PlayersSummary({ view }) {
  return (
    <div className="players-summary">
      <div className="ps-title">PLAYERS</div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`ps-row ${i === 0 ? 'ps-you' : ''}`}>
          <span className="ps-name">{PLAYER_NAMES[i]}</span>
          <span className="ps-cash">{formatCash(view.allCash[i])}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────
export default function App() {
  const [gameState, setGameState] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TICK_DURATION / 1000);
  const [started, setStarted] = useState(false);
  const gameRef = useRef(null);
  const pendingRef = useRef(null);
  const tickTimerRef = useRef(null);
  const countdownRef = useRef(null);

  // Keep refs in sync
  useEffect(() => {
    gameRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    pendingRef.current = pendingAction;
  }, [pendingAction]);

  const startGame = useCallback(() => {
    const state = initializeGame();
    setGameState(state);
    setPendingAction(null);
    setStarted(true);
    setTimeLeft(TICK_DURATION / 1000);
  }, []);

  // Tick loop
  useEffect(() => {
    if (!started || !gameState || gameState.gameOver) return;

    const tickStart = Date.now();

    // Countdown timer
    countdownRef.current = setInterval(() => {
      const elapsed = (Date.now() - tickStart) / 1000;
      const remaining = Math.max(0, TICK_DURATION / 1000 - elapsed);
      setTimeLeft(remaining);
    }, 100);

    // Tick execution
    tickTimerRef.current = setTimeout(() => {
      const state = gameRef.current;
      if (!state || state.gameOver) return;

      // Generate bot actions
      const actions = Array(NUM_PLAYERS).fill(null);
      actions[0] = pendingRef.current || { type: ActionType.NOTHING };
      for (let i = 1; i < NUM_PLAYERS; i++) {
        actions[i] = generateBotAction(state, i);
      }

      const newState = processActions(state, actions);
      setGameState(newState);
      setPendingAction(null);
      setTimeLeft(TICK_DURATION / 1000);
    }, TICK_DURATION);

    return () => {
      clearInterval(countdownRef.current);
      clearTimeout(tickTimerRef.current);
    };
  }, [started, gameState?.tick, gameState?.gameOver]);

  // Action handlers
  const handlePostBid = useCallback((commodity, price) => {
    setPendingAction({ type: ActionType.POST_BID, commodity, price });
  }, []);

  const handlePostAsk = useCallback((commodity, price) => {
    setPendingAction({ type: ActionType.POST_ASK, commodity, price });
  }, []);

  const handleAccept = useCallback((quoteId) => {
    setPendingAction({ type: ActionType.ACCEPT, quoteId });
  }, []);

  const handleCancel = useCallback((side) => {
    setPendingAction({
      type: side === 'bid' ? ActionType.CANCEL_BID : ActionType.CANCEL_ASK,
    });
  }, []);

  // Render
  if (!started || !gameState) {
    return <StartScreen onStart={startGame} />;
  }

  const view = getPlayerView(gameState, 0);

  // Estimate total wealth
  const estWealth =
    view.cash +
    view.inventory.reduce((sum, cnt, j) => {
      const val = view.knownValues[j] !== undefined ? view.knownValues[j] : 5.5;
      return sum + cnt * val;
    }, 0);

  return (
    <div className="game-container">
      <InfoBar view={view} timeLeft={timeLeft} totalWealth={estWealth} />

      <div className="main-area">
        <div className="commodity-grid">
          {Array.from({ length: NUM_COMMODITIES }, (_, j) => (
            <CommodityPanel
              key={j}
              index={j}
              view={view}
              pendingAction={
                pendingAction &&
                (pendingAction.commodity === j ||
                  (pendingAction.type === ActionType.ACCEPT &&
                    view.orderBook[pendingAction.quoteId]?.commodity === j))
                  ? pendingAction
                  : null
              }
              onPostBid={handlePostBid}
              onPostAsk={handlePostAsk}
              onAccept={handleAccept}
              onCancel={handleCancel}
            />
          ))}
        </div>

        <div className="sidebar">
          <PlayersSummary view={view} />
          <div className="sidebar-section">
            <div className="ps-title">TRADE LOG</div>
            <TradeLog log={view.tradeLog} />
          </div>
          <div className="sidebar-section info-known">
            <div className="ps-title">YOUR INTEL</div>
            {view.infoSet.map((j) => (
              <div key={j} className="intel-row">
                <span
                  className="intel-dot"
                  style={{ background: COMMODITY_COLORS[j] }}
                />
                <span className="intel-name">{COMMODITY_NAMES[j]}</span>
                <span className="intel-val">${view.knownValues[j]}</span>
              </div>
            ))}
          </div>
          {pendingAction && pendingAction.type !== ActionType.NOTHING && (
            <div className="sidebar-section pending-section">
              <div className="ps-title">QUEUED ACTION</div>
              <div className="pending-detail">
                {pendingAction.type.replace(/_/g, ' ').toUpperCase()}
                {pendingAction.price != null && ` @ $${pendingAction.price}`}
                {pendingAction.commodity != null &&
                  ` — ${COMMODITY_NAMES[pendingAction.commodity]}`}
                {pendingAction.quoteId != null && ` (Quote #${pendingAction.quoteId})`}
              </div>
              <button
                className="cancel-action-btn"
                onClick={() => setPendingAction(null)}
              >
                Clear Action
              </button>
            </div>
          )}
        </div>
      </div>

      {view.gameOver && (
        <GameOverScreen view={view} onRestart={startGame} />
      )}
    </div>
  );
}
