# Commodity Trading Game

A 4-player, 5-commodity trading game with asymmetric information. Built with React + Vite, designed for deployment on Vercel.

## Game Rules

- **4 players** (1 human + 3 bots), **5 commodities** with hidden terminal values (1–10)
- Each player knows the exact value of **2 out of 5** commodities
- Players start with equal total wealth and 10 commodity units
- Trade via a **public order book**: post bids/asks, accept quotes, or cancel
- **30 ticks × 5 seconds each** = 2.5 minute rounds
- Quotes posted this tick become visible next tick
- Final score = remaining cash + liquidation value of holdings

## Deploy on Vercel

1. Push this repo to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Vercel auto-detects Vite — no config needed
4. Deploy!

## Local Development

```bash
npm install
npm run dev
```

## Architecture

- `src/engine.js` — Pure game logic (state machine, bot AI, trade execution)
- `src/App.jsx` — React UI with all components
- `src/index.css` — Dark trading terminal theme
