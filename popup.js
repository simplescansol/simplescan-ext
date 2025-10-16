(() => {
  // ----- Config block (adjust thresholds here) -----
  const CONFIG = {
    cacheTtlMs: 10_000, // cache Dexscreener responses for 10s
    minLiquiditySol: 2, // minimum SOL-equivalent liquidity allowed before flagging
    maxFdvToLiquidity: 50, // if FDV / liquidity higher than this -> skewed
    minTransactions5m: 10, // minimum recent transaction count in 5 minutes
    minVolume5mUsd: 500, // minimum recent volume in USD
    recentLimit: 8,
    defaultSolPriceUsd: 150, // used when SOL price is unavailable for conversions
    minPairAgeHours: 12, // pairs newer than this are flagged as fresh launches
    volumeLiquidityAlert: 1.5, // if 1h volume greatly exceeds liquidity we flag churn risk
    sellPressureRatio: 0.7, // sells/(buys+sells) above this indicates dump pressure
    minTradesForPressure: 20 // require sufficient trades before evaluating sell pressure
  };

  const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const CACHE_KEY_PREFIX = "dex-cache:";
  const memoryCache = new Map();
  const TRIGGER_DESCRIPTIONS = {
    "thin liquidity": `thin liquidity (<${CONFIG.minLiquiditySol} SOL)`,
    "FDV/liquidity skewed": "FDV/liquidity skewed",
    "low recent activity": "low recent activity",
    "weak 5m volume": "weak 5m volume",
    "fresh launch": `fresh launch (<${CONFIG.minPairAgeHours}h old)`,
    "volume/liquidity imbalance": "1h volume vs liquidity imbalance",
    "sell pressure": "sell pressure in last 5m"
  };
  function describeTriggers(keys) {
    if (!Array.isArray(keys) || !keys.length) {
      return "No major red flags detected.";
    }
    const descriptions = keys.map((key) => TRIGGER_DESCRIPTIONS[key] || key);
    return descriptions.join(", ");
  }

  const elements = {
    mintInput: document.getElementById("mintInput"),
    scanButton: document.getElementById("scanButton"),
    buttonLabel: document.querySelector(".button-label"),
    spinner: document.querySelector(".spinner"),
    inputError: document.getElementById("inputError"),
    resultCard: document.getElementById("resultCard"),
    statusBadge: document.getElementById("statusBadge"),
    whyLine: document.getElementById("whyLine"),
    statLiqSol: document.getElementById("statLiqSol"),
    statLiqLabel: document.getElementById("statLiqLabel"),
    statFdv: document.getElementById("statFdv"),
    statVol: document.getElementById("statVol"),
    statTx: document.getElementById("statTx"),
    dexLink: document.getElementById("dexLink"),
    pumpLink: document.getElementById("pumpLink"),
    copyMint: document.getElementById("copyMint"),
    toast: document.getElementById("toast"),
    recentList: document.getElementById("recentList"),
    recentEmpty: document.getElementById("recentEmpty"),
    clearRecent: document.getElementById("clearRecent"),
    analysisList: document.getElementById("analysisList")
  };

  function validateMint(mint) {
    if (!mint || !BASE58_REGEX.test(mint.trim())) {
      return { valid: false, error: "Enter a valid Solana mint (32-44 base58 chars)." };
    }
    return { valid: true, mint: mint.trim() };
  }

  function setLoading(isLoading) {
    elements.scanButton.disabled = isLoading;
    elements.spinner.hidden = !isLoading;
    elements.buttonLabel.textContent = isLoading ? "Scanning..." : "Scan";
  }

  function clearError() {
    elements.inputError.hidden = true;
    elements.inputError.textContent = "";
  }

  function showError(message) {
    elements.inputError.hidden = false;
    elements.inputError.textContent = message;
  }

  function getCachedPair(mint) {
    const now = Date.now();
    const memo = memoryCache.get(mint);
    if (memo && memo.expires > now) {
      return memo.data;
    }
    const storedRaw = localStorage.getItem(CACHE_KEY_PREFIX + mint);
    if (storedRaw) {
      try {
        const parsed = JSON.parse(storedRaw);
        if (parsed.expires > now) {
          memoryCache.set(mint, { data: parsed.data, expires: parsed.expires });
          return parsed.data;
        }
      } catch (err) {
        console.warn("Failed to parse cached pair", err);
      }
    }
    return null;
  }

  function setCachedPair(mint, pair) {
    const expires = Date.now() + CONFIG.cacheTtlMs;
    const payload = { data: pair, expires };
    memoryCache.set(mint, payload);
    try {
      localStorage.setItem(CACHE_KEY_PREFIX + mint, JSON.stringify(payload));
    } catch (err) {
      console.warn("Failed to persist pair cache", err);
    }
  }

  async function fetchPair(mint) {
    const cached = getCachedPair(mint);
    if (cached) {
      return cached;
    }

    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("network");
    }

    const data = await response.json();
    const pair = Array.isArray(data?.pairs) ? data.pairs[0] : null;

    if (!pair) {
      const err = new Error("no_pair");
      err.code = "no_pair";
      throw err;
    }

    setCachedPair(mint, pair);
    return pair;
  }

  function scorePair(pair) {
    const liqUsd = Number(pair?.liquidity?.usd) || 0;
    const liquidityInfo = deriveLiquidity(pair, liqUsd);
    const liqSol = liquidityInfo.solForScore;
    const fdv = Number(pair?.fdv) || 0;
    const vol5m = Number(pair?.volume?.m5) || 0;
    const volume1h = Number(pair?.volume?.h1) || 0;
    const buys5m = Number(pair?.txns?.m5?.buys) || 0;
    const sells5m = Number(pair?.txns?.m5?.sells) || 0;
    const tx5m = buys5m + sells5m;
    const fdvToLiq = liqUsd > 0 ? fdv / liqUsd : Number.POSITIVE_INFINITY;
    const volumeToLiquidity = liqUsd > 0 ? volume1h / liqUsd : 0;
    const sellRatio5m = tx5m > 0 ? sells5m / tx5m : 0;
    const pairAgeMs =
      pair?.pairCreatedAt && Number.isFinite(Number(pair.pairCreatedAt))
        ? Date.now() - Number(pair.pairCreatedAt)
        : Number.POSITIVE_INFINITY;
    const pairAgeHours = Number.isFinite(pairAgeMs) && pairAgeMs > 0 ? pairAgeMs / 3_600_000 : Number.POSITIVE_INFINITY;

    let score = 0;
    const triggers = [];

    if (liqSol < CONFIG.minLiquiditySol) {
      score += 3;
      triggers.push("thin liquidity");
    }

    if (fdvToLiq > CONFIG.maxFdvToLiquidity) {
      score += 2;
      triggers.push("FDV/liquidity skewed");
    }

    if (tx5m < CONFIG.minTransactions5m) {
      score += 1;
      triggers.push("low recent activity");
    }

    if (vol5m < CONFIG.minVolume5mUsd) {
      score += 1;
      triggers.push("weak 5m volume");
    }

    if (pairAgeHours < CONFIG.minPairAgeHours) {
      score += 2;
      triggers.push("fresh launch");
    }

    if (volumeToLiquidity > CONFIG.volumeLiquidityAlert && volume1h > CONFIG.minVolume5mUsd) {
      score += 1;
      triggers.push("volume/liquidity imbalance");
    }

    if (tx5m >= CONFIG.minTradesForPressure && sellRatio5m > CONFIG.sellPressureRatio) {
      score += 1;
      triggers.push("sell pressure");
    }

    const labelMeta = getLabelMeta(score);
    const analysis = {
      pairAgeHours,
      volumeToLiquidity,
      volume1h,
      buys5m,
      sells5m,
      sellRatio5m
    };

    return {
      score,
      liqUsd,
      liqSol,
      fdv,
      vol5m,
      volume1h,
      tx5m,
      liquidityDisplay: liquidityInfo.displayAmount,
      liquidityDisplayKind: liquidityInfo.displayKind,
      liquiditySymbol: liquidityInfo.displaySymbol,
      fdvToLiq,
      analysis,
      triggers,
      ...labelMeta
    };
  }

  function deriveLiquidity(pair, liqUsd) {
    const quoteToken = pair?.quoteToken || {};
    const quoteSymbol = typeof quoteToken.symbol === "string" ? quoteToken.symbol.toUpperCase() : "";
    const quoteAddress = typeof quoteToken.address === "string" ? quoteToken.address.toUpperCase() : "";
    const liquidityQuote = Number(pair?.liquidity?.quote) || 0;
    const baseLiquidity = Number(pair?.liquidity?.base) || 0;
    const priceNative = Number(pair?.priceNative) || 0; // price expressed in quote token
    const priceUsd = Number(pair?.priceUsd) || 0;

    const isSolPool = isSolToken(quoteAddress, quoteSymbol);

    const quoteTokenPriceUsd = Number(quoteToken.priceUsd) || 0;
    const solPriceUsdCandidate =
      (isSolPool && quoteTokenPriceUsd > 0) || quoteTokenPriceUsd > 10
        ? quoteTokenPriceUsd
        : CONFIG.defaultSolPriceUsd;

    const estimatedQuoteAmount =
      liquidityQuote > 0
        ? liquidityQuote
        : baseLiquidity > 0 && priceNative > 0
        ? baseLiquidity * priceNative
        : 0;

    let usdLiquidity = liqUsd > 0 ? liqUsd : 0;
    if (usdLiquidity <= 0 && estimatedQuoteAmount > 0 && quoteTokenPriceUsd > 0) {
      usdLiquidity = estimatedQuoteAmount * quoteTokenPriceUsd;
    }
    if (usdLiquidity <= 0 && baseLiquidity > 0 && priceUsd > 0) {
      usdLiquidity = baseLiquidity * priceUsd;
    }

    let solEstimate = 0;
    if (isSolPool) {
      solEstimate =
        estimatedQuoteAmount > 0
          ? estimatedQuoteAmount
          : usdLiquidity > 0
          ? usdLiquidity / solPriceUsdCandidate
          : 0;
    } else if (usdLiquidity > 0) {
      solEstimate = usdLiquidity / solPriceUsdCandidate;
    }

    const displayKind = isSolPool ? "sol" : "usd";
    const displayAmount =
      displayKind === "sol"
        ? estimatedQuoteAmount > 0
          ? estimatedQuoteAmount
          : solEstimate
        : usdLiquidity;

    const displaySymbol = displayKind === "sol" ? "SOL" : quoteSymbol || "USD";

    return {
      solForScore: Number.isFinite(solEstimate) && solEstimate > 0 ? solEstimate : 0,
      displayAmount: Number.isFinite(displayAmount) && displayAmount > 0 ? displayAmount : 0,
      displayKind,
      displaySymbol
    };
  }

  function isSolToken(address, symbol) {
    if (!address && !symbol) return false;
    if (address) {
      const normalized = address.toUpperCase();
      if (normalized === SOL_MINT) return true;
    }
    if (!symbol) return false;
    const upper = symbol.toUpperCase();
    return upper === "SOL" || upper === "WSOL";
  }

  function getLabelMeta(score) {
    if (score >= 5) {
      return { label: "Rug Vibes", emoji: "\u{1F534}", badgeClass: "badge-rug" };
    }
    if (score >= 3) {
      return { label: "Risky", emoji: "\u{1F7E0}", badgeClass: "badge-risky" };
    }
    return { label: "Safe", emoji: "\u{1F7E2}", badgeClass: "badge-safe" };
  }

  function formatUsdShort(value) {
    if (!Number.isFinite(value) || value <= 0) return "--";
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}b`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
    return `$${value.toFixed(0)}`;
  }

  function formatTokenAmount(value) {
    if (!Number.isFinite(value) || value <= 0) return "--";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return value.toFixed(2);
  }

  function formatMultiple(value) {
    if (!Number.isFinite(value) || value <= 0) return "--";
    if (value === Number.POSITIVE_INFINITY) return ">1000x";
    if (value >= 1000) return ">1000x";
    if (value >= 10) return `${value.toFixed(0)}x`;
    return `${value.toFixed(1)}x`;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "--";
    return `${Math.round(value * 100)}%`;
  }

  function formatAge(hours) {
    if (!Number.isFinite(hours)) return "--";
    if (hours < 1) return "<1h";
    if (hours < 24) return `${hours.toFixed(1)}h`;
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }

  function formatBuySell(buys, sells) {
    const total = buys + sells;
    if (total <= 0) return "--";
    const sellRatio = sells / total;
    return `${buys}/${sells} (${formatPercent(sellRatio)} sells)`;
  }

  function renderResult(mint, result) {
    const {
      label,
      emoji,
      badgeClass,
      triggers,
      liquidityDisplay,
      liquidityDisplayKind,
      liquiditySymbol,
      fdv,
      vol5m,
      tx5m,
      fdvToLiq,
      analysis
    } = result;
    elements.statusBadge.textContent = `${emoji} ${label}`;
    elements.statusBadge.className = `status-badge ${badgeClass}`;

    elements.whyLine.textContent = describeTriggers(triggers);

    const liquidityLabel = liquidityDisplayKind === "usd" ? `LP (${liquiditySymbol || "USD"})` : "LP (SOL)";
    elements.statLiqLabel.textContent = liquidityLabel;
    elements.statLiqSol.textContent =
      liquidityDisplayKind === "usd" ? formatUsdShort(liquidityDisplay) : formatTokenAmount(liquidityDisplay);
    elements.statFdv.textContent = formatUsdShort(fdv);
    elements.statVol.textContent = formatUsdShort(vol5m);
    elements.statTx.textContent = Number.isFinite(tx5m) ? tx5m.toString() : "--";
    renderAnalysis({
      fdvToLiq,
      analysis,
      vol5m
    });

    elements.dexLink.href = `https://dexscreener.com/solana/${mint}`;
    elements.pumpLink.href = `https://pump.fun/${mint}`;
    elements.copyMint.dataset.mint = mint;

    elements.resultCard.hidden = false;
  }

  function renderErrorCard(message) {
    elements.statusBadge.textContent = "\u26A0\uFE0F Error";
    elements.statusBadge.className = "status-badge badge-risky";
    elements.whyLine.textContent = message;
    elements.statLiqLabel.textContent = "LP (--)";
    elements.statLiqSol.textContent = "--";
    elements.statFdv.textContent = "--";
    elements.statVol.textContent = "--";
    elements.statTx.textContent = "--";
    if (elements.analysisList) {
      elements.analysisList.innerHTML = "";
    }
    elements.dexLink.href = "#";
    elements.pumpLink.href = "#";
    elements.copyMint.dataset.mint = "";
    elements.resultCard.hidden = false;
  }

  async function loadRecentScans() {
    const stored = await getFromStorage("recentScans");
    const list = Array.isArray(stored) ? stored : [];
    updateRecentList(list);
  }

  async function saveRecentScan(entry) {
    const stored = await getFromStorage("recentScans");
    let list = Array.isArray(stored) ? stored : [];
    list = list.filter((item) => item.mint !== entry.mint);
    list.unshift(entry);
    if (list.length > CONFIG.recentLimit) {
      list = list.slice(0, CONFIG.recentLimit);
    }
    await setInStorage({ recentScans: list });
    updateRecentList(list);
  }

  async function clearRecentScans() {
    await setInStorage({ recentScans: [] });
    updateRecentList([]);
  }

  function updateRecentList(list) {
    elements.recentList.innerHTML = "";
    if (!list.length) {
      elements.recentEmpty.hidden = false;
      elements.clearRecent.disabled = true;
      return;
    }
    elements.recentEmpty.hidden = true;
    elements.clearRecent.disabled = false;

    for (const item of list) {
      const li = document.createElement("li");
      li.className = "recent-item";
      li.dataset.mint = item.mint;
      li.dataset.label = item.label;

      const meta = document.createElement("div");
      meta.className = "recent-metadata";

      const mintSpan = document.createElement("span");
      mintSpan.className = "recent-mint";
      mintSpan.textContent = item.mint;

      const whenSpan = document.createElement("span");
      whenSpan.className = "recent-meta";
      whenSpan.textContent = timeAgo(item.ts);

      const chip = document.createElement("span");
      chip.className = "recent-chip";
      chip.textContent = `${item.label} (${item.score})`;

      meta.appendChild(mintSpan);
      meta.appendChild(whenSpan);
      li.appendChild(meta);
      li.appendChild(chip);
      elements.recentList.appendChild(li);
    }
  }

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins}m ago`;
    }
    const hours = Math.floor(seconds / 3600);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function getFromStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          console.warn("storage get failed", chrome.runtime.lastError);
          resolve(undefined);
        } else {
          resolve(result[key]);
        }
      });
    });
  }

  function setInStorage(entries) {
    return new Promise((resolve) => {
      chrome.storage.local.set(entries, () => {
        if (chrome.runtime.lastError) {
          console.warn("storage set failed", chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    setTimeout(() => {
      elements.toast.hidden = true;
    }, 1500);
  }

  function renderAnalysis(payload) {
    if (!elements.analysisList) return;
    elements.analysisList.innerHTML = "";
    const info = payload?.analysis || {};
    const items = [
      { label: "Pair age", value: formatAge(info.pairAgeHours) },
      { label: "FDV / Liquidity", value: formatMultiple(payload?.fdvToLiq) },
      { label: "1h volume vs LP", value: formatMultiple(info.volumeToLiquidity) },
      { label: "5m buys / sells", value: formatBuySell(info.buys5m || 0, info.sells5m || 0) }
    ];

    for (const { label, value } of items) {
      const li = document.createElement("li");
      li.className = "analysis-item";
      const labelSpan = document.createElement("span");
      labelSpan.className = "label";
      labelSpan.textContent = label;
      const valueSpan = document.createElement("span");
      valueSpan.className = "value";
      valueSpan.textContent = value;
      li.appendChild(labelSpan);
      li.appendChild(valueSpan);
      elements.analysisList.appendChild(li);
    }
  }

  async function handleScan() {
    clearError();
    const rawMint = elements.mintInput.value;
    const { valid, mint, error } = validateMint(rawMint);
    if (!valid) {
      showError(error);
      return;
    }

    setLoading(true);
    try {
      const pair = await fetchPair(mint);
      const scored = scorePair(pair);
      renderResult(mint, scored);
      await saveRecentScan({
        mint,
        label: scored.label,
        score: scored.score,
        ts: Date.now()
      });
    } catch (err) {
      if (err?.code === "no_pair") {
        renderErrorCard("No live pair found on Dexscreener for this mint.");
      } else if (err?.message === "network") {
        renderErrorCard("Couldn't reach Dexscreener. Try again.");
      } else {
        console.error("Unexpected scan error", err);
        renderErrorCard("Something went wrong. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleInputChange() {
    if (!elements.inputError.hidden) {
      clearError();
    }
  }

  function handleEnterSubmit(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleScan();
    }
  }

  async function handleRecentClick(event) {
    const li = event.target.closest(".recent-item");
    if (!li) return;
    const mint = li.dataset.mint;
    if (!mint) return;
    elements.mintInput.value = mint;
    await handleScan();
  }

  function handleCopyMint() {
    const mint = elements.copyMint.dataset.mint;
    if (!mint) return;
    navigator.clipboard
      .writeText(mint)
      .then(() => showToast("Copied!"))
      .catch((err) => {
        console.warn("Clipboard copy failed", err);
        showToast("Copy failed");
      });
  }

  function init() {
    loadRecentScans();
    elements.scanButton.addEventListener("click", handleScan);
    elements.mintInput.addEventListener("input", handleInputChange);
    elements.mintInput.addEventListener("keydown", handleEnterSubmit);
    elements.recentList.addEventListener("click", handleRecentClick);
    elements.copyMint.addEventListener("click", handleCopyMint);
    elements.clearRecent.addEventListener("click", clearRecentScans);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
