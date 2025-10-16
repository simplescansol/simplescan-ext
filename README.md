# SimpleScan - RugMeter Lite

Scan any Solana token instantly.
SimpleScan gives you instant insight into liquidity, volume, and trading activity, helping you spot rugs before they happen.

⚡ Key Features

Instant Token Scans: Paste any Solana mint address and get results in seconds.

Risk Ratings: See clear visual badges — 🟢 Safe, 🟠 Risky, 🔴 Rug Vibes — based on live data.

Live Metrics: View liquidity (SOL), FDV, 5-minute volume, and recent transaction counts.

Lightweight & Fast: No sign-ins, no tracking, no bloat, just data.

Recent Scans: Automatically saves your latest lookups for quick re-checks.

🔍 Why SimpleScan?

Because crypto moves fast, and bad data costs SOL.
SimpleScan gives you a clean, honest snapshot of any token’s on-chain activity so you can trade smarter, not riskier.
Built by traders, for traders.

🧩 Perfect For

Pump.fun and Dexscreener users

Token creators and analysts

Solana traders who move fast but think first

Scan smart. Stay safe.

## Install
- Open `chrome://extensions`
- Enable **Developer mode** (top-right toggle)
- Click **Load unpacked** and choose this project folder

## Use
- Click the SimpleScan extension icon
- Paste a Solana mint address and press **Scan**
- Review the risk badge, explanation, stats, and quick links
- Use **Copy Mint** for the clipboard or re-run past entries from *Recent scans*

## Notes
- Uses the public Dexscreener API directly; no backend or wallet access
- Recent scans (max 8) and the 10s response cache are stored in `chrome.storage.local`
- Handles invalid mints, network errors, and missing pair data gracefully
- Risk checks compare liquidity depth, FDV ratio, trade flow (buy/sell split), 1h volume vs liquidity, and pair age for a quick pulse on potential rugs
