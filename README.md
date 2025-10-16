# SimpleScan - RugMeter Lite

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
