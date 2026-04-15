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
  PREP_DURATION,
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
        <h1 className="start-title">FRACTA</h1>
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
            <span>10s prep, then 30 ticks × 10 seconds. Maximize cash + liquidation value.</span>
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
function OrderBookDisplay({ orderBook, commodity, onAccept, queuedAcceptIds }) {
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
          bids.map((q) => {
            const queued = queuedAcceptIds.has(q.id);
            return (
              <div key={q.id} className={`ob-row bid-row${queued ? ' ob-queued' : ''}`}>
                <span className="ob-price">${q.price}</span>
                <span className="ob-player">
                  {PLAYER_NAMES[q.player].substring(0, 5)}
                </span>
                {q.player !== 0 && (
                  <button
                    className={`ob-accept-btn ${queued ? 'queued-btn' : 'sell-btn-sm'}`}
                    onClick={() => onAccept(q.id)}
                    title={queued ? 'Already queued — click to queue again' : 'Sell to this bidder'}
                  >
                    {queued ? '✓ QUEUED' : 'SELL'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="ob-side ob-asks">
        <div className="ob-header">ASKS</div>
        {asks.length === 0 ? (
          <div className="ob-empty">—</div>
        ) : (
          asks.map((q) => {
            const queued = queuedAcceptIds.has(q.id);
            return (
              <div key={q.id} className={`ob-row ask-row${queued ? ' ob-queued' : ''}`}>
                <span className="ob-price">${q.price}</span>
                <span className="ob-player">
                  {PLAYER_NAMES[q.player].substring(0, 5)}
                </span>
                {q.player !== 0 && (
                  <button
                    className={`ob-accept-btn ${queued ? 'queued-btn' : 'buy-btn-sm'}`}
                    onClick={() => onAccept(q.id)}
                    title={queued ? 'Already queued — click to queue again' : 'Buy from this seller'}
                  >
                    {queued ? '✓ QUEUED' : 'BUY'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Commodity Panel ─────────────────────────────────────────────
function CommodityPanel({
  index,
  view,
  isPrep,
  queuedActions,
  queuedAcceptIds,
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

  const myBidId = view.activeBids[index];
  const myAskId = view.activeAsks[index];
  const myBidQuote = myBidId != null ? view.orderBook[myBidId] : null;
  const myAskQuote = myAskId != null ? view.orderBook[myAskId] : null;
  const hasBidOnThis = !!myBidQuote;
  const hasAskOnThis = !!myAskQuote;

  const isKnown = known !== undefined;
  const submitBid = () => {
    const p = parseInt(bidPrice);
    if (p >= PRICE_MIN && p <= PRICE_MAX) {
      onPostBid(index, p);
      setBidPrice('');
    }
  };
  const submitAsk = () => {
    const p = parseInt(askPrice);
    if (p >= PRICE_MIN && p <= PRICE_MAX) {
      onPostAsk(index, p);
      setAskPrice('');
    }
  };

  return (
    <div
      className={`commodity-panel${isKnown ? ' known' : ''}`}
      style={{ '--accent': color }}
    >
      <div className="cp-header">
        <span className="cp-dot" style={{ background: color }} />
        <span className="cp-name">{name}</span>
        {isKnown ? (
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
        onAccept={isPrep ? () => {} : onAccept}
        queuedAcceptIds={queuedAcceptIds}
      />

      <div className="cp-actions">
        <div className="cp-action-row">
          <input
            type="number"
            min={PRICE_MIN}
            max={PRICE_MAX}
            placeholder="Bid $ ↵"
            value={bidPrice}
            onChange={(e) => setBidPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitBid();
            }}
            disabled={view.gameOver || isPrep}
            className="cp-input cp-input-bid"
          />
          <input
            type="number"
            min={PRICE_MIN}
            max={PRICE_MAX}
            placeholder="Ask $ ↵"
            value={askPrice}
            onChange={(e) => setAskPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAsk();
            }}
            disabled={view.gameOver || isPrep || holding < 1}
            className="cp-input cp-input-ask"
          />
        </div>

        {(hasBidOnThis || hasAskOnThis) && (
          <div className="cp-active-quotes">
            {hasBidOnThis && (
              <div className="active-quote bid-active">
                Your bid: ${myBidQuote.price}
                <button
                  className="cancel-btn"
                  onClick={() => onCancel(myBidQuote.id)}
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
                  onClick={() => onCancel(myAskQuote.id)}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {queuedActions && queuedActions.length > 0 && (
        <div className="cp-pending">
          {queuedActions.map((a, i) => (
            <div key={i} className="cp-pending-row">
              {a.type.replace(/_/g, ' ')}
              {a.price != null && ` @ $${a.price}`}
            </div>
          ))}
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
  const [pendingActions, setPendingActions] = useState([]);
  const [timeLeft, setTimeLeft] = useState(TICK_DURATION / 1000);
  const [started, setStarted] = useState(false);
  const [prepTimeLeft, setPrepTimeLeft] = useState(0);
  const gameRef = useRef(null);
  const pendingRef = useRef([]);
  const tickTimerRef = useRef(null);
  const countdownRef = useRef(null);
  const prepTimerRef = useRef(null);

  // Keep refs in sync
  useEffect(() => {
    gameRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    pendingRef.current = pendingActions;
  }, [pendingActions]);

  const startGame = useCallback(() => {
    const state = initializeGame();
    setGameState(state);
    setPendingActions([]);
    setStarted(true);
    setTimeLeft(TICK_DURATION / 1000);
    setPrepTimeLeft(PREP_DURATION / 1000);
  }, []);

  // Prep countdown (runs once at start, before first tick)
  useEffect(() => {
    if (!started || !gameState) return;
    if (prepTimeLeft <= 0) return;

    const prepStart = Date.now();
    prepTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - prepStart) / 1000;
      const remaining = Math.max(0, PREP_DURATION / 1000 - elapsed);
      setPrepTimeLeft(remaining);
      if (remaining <= 0) clearInterval(prepTimerRef.current);
    }, 100);

    return () => clearInterval(prepTimerRef.current);
  }, [started, gameState?.tick === 0 && prepTimeLeft > 0]);

  // Tick loop
  useEffect(() => {
    if (!started || !gameState || gameState.gameOver) return;
    if (prepTimeLeft > 0) return;

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

      // Assemble actions (human: full queue; bots: single action each)
      const actions = Array(NUM_PLAYERS).fill(null);
      actions[0] = pendingRef.current.length > 0 ? pendingRef.current : [];
      for (let i = 1; i < NUM_PLAYERS; i++) {
        const result = generateBotAction(state, i);
        actions[i] = Array.isArray(result) ? result : [result];
      }

      const newState = processActions(state, actions);
      setGameState(newState);
      setPendingActions([]);
      setTimeLeft(TICK_DURATION / 1000);
    }, TICK_DURATION);

    return () => {
      clearInterval(countdownRef.current);
      clearTimeout(tickTimerRef.current);
    };
  }, [started, gameState?.tick, gameState?.gameOver, prepTimeLeft > 0]);

  // Action handlers — each queues a new action for this tick
  const enqueue = useCallback((action) => {
    setPendingActions((prev) => [...prev, action]);
  }, []);

  const handlePostBid = useCallback(
    (commodity, price) => enqueue({ type: ActionType.POST_BID, commodity, price }),
    [enqueue]
  );
  const handlePostAsk = useCallback(
    (commodity, price) => enqueue({ type: ActionType.POST_ASK, commodity, price }),
    [enqueue]
  );
  const handleAccept = useCallback(
    (quoteId) => enqueue({ type: ActionType.ACCEPT, quoteId }),
    [enqueue]
  );
  const handleCancel = useCallback(
    (quoteId) => enqueue({ type: ActionType.CANCEL_QUOTE, quoteId }),
    [enqueue]
  );

  const removeQueuedAction = useCallback((idx) => {
    setPendingActions((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  const clearAllQueued = useCallback(() => setPendingActions([]), []);

  // Render
  if (!started || !gameState) {
    return <StartScreen onStart={startGame} />;
  }

  const view = getPlayerView(gameState, 0);
  const isPrep = prepTimeLeft > 0;

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
          {Array.from({ length: NUM_COMMODITIES }, (_, j) => {
            const queuedHere = pendingActions.filter(
              (a) =>
                a.commodity === j ||
                (a.quoteId != null &&
                  view.orderBook[a.quoteId]?.commodity === j)
            );
            const queuedAcceptIds = new Set(
              pendingActions
                .filter((a) => a.type === ActionType.ACCEPT)
                .map((a) => a.quoteId)
            );
            return (
              <CommodityPanel
                key={j}
                index={j}
                view={view}
                isPrep={isPrep}
                queuedActions={queuedHere}
                queuedAcceptIds={queuedAcceptIds}
                onPostBid={handlePostBid}
                onPostAsk={handlePostAsk}
                onAccept={handleAccept}
                onCancel={handleCancel}
              />
            );
          })}
        </div>

        <div className="sidebar">
          {pendingActions.length > 0 && (
            <div className="sidebar-section pending-section pending-sticky">
              <div className="ps-title">
                QUEUED ACTIONS ({pendingActions.length}) — ALL FIRE NEXT TICK
              </div>
              {pendingActions.map((a, i) => {
                const commodity =
                  a.commodity != null
                    ? a.commodity
                    : a.quoteId != null
                    ? view.orderBook[a.quoteId]?.commodity
                    : null;
                return (
                  <div key={i} className="queued-row">
                    <span className="queued-text">
                      {a.type.replace(/_/g, ' ').toUpperCase()}
                      {commodity != null && ` — ${COMMODITY_NAMES[commodity]}`}
                      {a.price != null && ` @ $${a.price}`}
                      {a.quoteId != null && ` #${a.quoteId}`}
                    </span>
                    <button
                      className="queued-remove"
                      onClick={() => removeQueuedAction(i)}
                      title="Remove from queue"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button className="cancel-action-btn" onClick={clearAllQueued}>
                Clear All
              </button>
            </div>
          )}
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
        </div>
      </div>

      {isPrep && (
        <div className="prep-overlay">
          <div className="prep-card">
            <div className="prep-label">GET READY</div>
            <div className="prep-countdown">{Math.ceil(prepTimeLeft)}</div>
            <div className="prep-hint">
              Review your commodities and known true values.
              <br />
              Trading opens when the countdown hits zero.
            </div>
          </div>
        </div>
      )}

      {view.gameOver && (
        <GameOverScreen view={view} onRestart={startGame} />
      )}
    </div>
  );
}
