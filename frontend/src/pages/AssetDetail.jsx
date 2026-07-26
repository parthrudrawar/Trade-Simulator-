import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { useSocketPrice } from "../hooks/useSocketPrice";
import { api, getAccessToken } from "../services/api";
import AdvancedChart from "../components/AdvancedChart";

const FORMAT_CURRENCY = (v, isCrypto) => {
  if (v == null) return "-";
  if (isCrypto) return `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const FORMAT_LARGE = (v, isCrypto) => {
  if (v == null) return "-";
  if (isCrypto) {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${Number(v).toLocaleString("en-US")}`;
  }
  if (v >= 1e14) return `₹${(v / 1e14).toFixed(2)}L Cr`;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Number(v).toLocaleString("en-IN")}`;
};

const RANGES = [
  { key: "1d", interval: "1m" },
  { key: "5d", interval: "5m" },
  { key: "1mo", interval: "15m" },
  { key: "3mo", interval: "1h" },
  { key: "6mo", interval: "1d" },
  { key: "1y", interval: "1w" },
];

const FORMAT_SUPPLY = (v) => {
  if (v == null) return "-";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return Number(v).toLocaleString("en-US");
};

export default function AssetDetail() {
  const { assetType, symbol } = useParams();
  const normalizedSymbol = symbol?.toUpperCase();
  const isCrypto = assetType === "crypto";

  const [range, setRange] = useState("1mo");
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [news, setNews] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState({ history: true, stats: true, news: false });
  const [orderResult, setOrderResult] = useState(null);
  const [orderError, setOrderError] = useState("");

  const [explanation, setExplanation] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState("");
  const [explainArticles, setExplainArticles] = useState([]);
  const eventSourceRef = useRef(null);

  const [side, setSide] = useState("buy");
  const [quantity, setQuantity] = useState("");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const watchSymbols = useMemo(
    () => [{ assetType, symbol: normalizedSymbol }],
    [assetType, normalizedSymbol],
  );
  const prices = useSocketPrice(watchSymbols);
  const priceKey = `${assetType}:${normalizedSymbol}`;
  const priceData = prices[priceKey];
  const currentPrice = priceData?.price;

  const cashAvailable = isCrypto
    ? summary?.cashUSD || 0
    : summary?.cashINR || 0;

  const cashLabel = isCrypto ? "USD" : "INR";

  const formatPrice = useCallback((v) => FORMAT_CURRENCY(v, isCrypto), [isCrypto]);
  const formatLarge = useCallback((v) => FORMAT_LARGE(v, isCrypto), [isCrypto]);

  useEffect(() => {
    api.get("/analytics/summary").then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading((p) => ({ ...p, history: true }));
    const rangeConfig = RANGES.find((r) => r.key === range);
    const interval = rangeConfig?.interval || "1d";
    api.get(`/market/chart/${normalizedSymbol}?range=${range}&interval=${interval}`)
      .then((data) => setHistory(data.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading((p) => ({ ...p, history: false })));
  }, [normalizedSymbol, range]);

  useEffect(() => {
    setLoading((p) => ({ ...p, stats: true }));
    Promise.all([
      api.get(`/market/info/${normalizedSymbol}`).catch(() => ({ info: null })),
      api.get(`/market/stats/${assetType}/${normalizedSymbol}`).catch(() => ({ stats: null }))
    ]).then(([infoRes, statsRes]) => {
      const info = infoRes?.info;
      const stats = statsRes?.stats;
      // Merge: prefer stats for missing fields
      const merged = info ? { ...stats, ...info } : stats;
      setStats(merged || null);
    }).finally(() => setLoading((p) => ({ ...p, stats: false })));
  }, [assetType, normalizedSymbol]);

  useEffect(() => {
    setLoading((p) => ({ ...p, news: true }));
    api.get(`/market/news/${assetType}/${normalizedSymbol}`)
      .then((data) => setNews(data.news || []))
      .catch(() => setNews([]))
      .finally(() => setLoading((p) => ({ ...p, news: false })));
  }, [assetType, normalizedSymbol]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleExplain = () => {
    if (explaining) return;

    setExplaining(true);
    setExplanation(null);
    setExplainError("");
    setExplainArticles([]);
    const bullets = [];

    const token = getAccessToken();
    const url = `/rag/explain/${assetType}/${normalizedSymbol}?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("bullet", (event) => {
      const data = JSON.parse(event.data);
      bullets.push(data);
      setExplanation([...bullets]);
      if (data.article) {
        setExplainArticles((prev) => {
          if (prev.find((a) => a.id === data.article.id)) return prev;
          return [...prev, data.article];
        });
      }
    });

    es.addEventListener("error", (event) => {
      const data = event.data ? JSON.parse(event.data) : {};
      setExplainError(data.message || "Failed to generate explanation");
      es.close();
      setExplaining(false);
    });

    es.addEventListener("done", () => {
      es.close();
      setExplaining(false);
    });

    es.onerror = () => {
      if (bullets.length === 0) {
        setExplainError("Connection failed. Please try again.");
      }
      es.close();
      setExplaining(false);
    };
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    setOrderError("");
    setOrderResult(null);
    setSubmitting(true);
    try {
      const body = {
        assetType,
        assetSymbol: normalizedSymbol,
        side,
        quantity: Number(quantity),
        orderType,
      };
      if (orderType === "limit" || orderType === "bracket") body.limitPrice = Number(limitPrice);
      if (orderType === "stop_loss" || orderType === "bracket") body.stopPrice = Number(stopPrice);
      if (orderType === "bracket") body.targetPrice = Number(targetPrice);
      const res = await api.post("/orders", body);
      setOrderResult(res);
      setQuantity("");
      setLimitPrice("");
      setStopPrice("");
      setTargetPrice("");
    } catch (err) {
      setOrderError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const StatRow = ({ label, value }) => (
    <div className="flex justify-between py-1.5 text-sm border-b border-gray-800/50 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono text-gray-200">{value}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono">{normalizedSymbol}</h1>
          <span className="text-xs text-gray-500 uppercase">{assetType}</span>
          {stats?.name && <span className="text-sm text-gray-400 ml-3">{stats.name}</span>}
        </div>
        <div className="text-right">
          {currentPrice != null ? (
            <>
              <div className="text-3xl font-bold font-mono">{formatPrice(currentPrice)}</div>
              <div className={`text-sm font-medium ${priceData?.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {priceData?.change >= 0 ? "+" : ""}{priceData?.changePercent?.toFixed(2)}%
                <span className="text-gray-500 ml-2 text-xs">Today</span>
              </div>
            </>
          ) : (
            <div className="text-xl text-gray-500 font-mono">Waiting for price...</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 space-y-4">
          <AdvancedChart
            history={history}
            range={range}
            onRangeChange={setRange}
            normalizedSymbol={normalizedSymbol}
            loading={loading.history}
          />

          {news.length > 0 && (
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Latest News</h3>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {news.map((item, i) => (
                  <a
                    key={i}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-800/50 rounded-lg p-3 hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex gap-3">
                      {item.imageUrl && (
                        <img src={item.imageUrl} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-200 line-clamp-2">{item.title}</div>
                        {item.description && (
                          <div className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</div>
                        )}
                        <div className="text-xs text-gray-600 mt-1">
                          {item.source} · {new Date(item.publishedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Why is it moving? — RAG-powered explanation */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">Why is it moving?</h3>
              <button
                onClick={handleExplain}
                disabled={explaining}
                className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors"
              >
                {explaining ? "Analyzing..." : "Analyze"}
              </button>
            </div>

            {explainError && (
              <div className="bg-red-900/50 text-red-300 text-sm p-2 rounded mb-2">{explainError}</div>
            )}

            {explaining && !explanation && (
              <div className="text-gray-500 text-sm py-2 animate-pulse">Retrieving relevant news articles...</div>
            )}

            {explanation && explanation.length > 0 && (
              <div className="space-y-2">
                {explanation.map((bullet, i) => (
                  <div key={i} className="bg-gray-800/50 rounded-lg p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold mt-0.5">•</span>
                      <p className="text-gray-200">{bullet.text}</p>
                    </div>
                    {bullet.article && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          const newsItems = document.querySelectorAll('[class*="news"]');
                          if (newsItems.length > 0) newsItems[0].scrollIntoView({ behavior: "smooth" });
                        }}
                        className="text-xs text-gray-500 hover:text-emerald-400 ml-5 mt-1 inline-block"
                      >
                        {bullet.article.title.slice(0, 60)}... [Source: {bullet.article.source}]
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!explaining && !explanation && !explainError && (
              <p className="text-gray-500 text-sm">Click "Analyze" to get an AI-powered explanation of recent price movements, grounded in news articles.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Key Stats</h3>
            {loading.stats ? (
              <div className="text-gray-500 text-sm py-4">Loading...</div>
            ) : stats ? (
              <div>
                {isCrypto ? (
                  <>
                    <StatRow label="Market Cap" value={formatLarge(stats.marketCap)} />
                    <StatRow label="High" value={formatPrice(stats.high)} />
                    <StatRow label="Low" value={formatPrice(stats.low)} />
                    <StatRow label="Volume (24h)" value={formatLarge(stats.volume)} />
                    <StatRow label="Open" value={formatPrice(stats.open)} />
                    <StatRow label="Previous Close" value={formatPrice(stats.previousClose)} />
                  </>
                ) : (
                  <>
                    <StatRow label="Market Cap" value={formatLarge(stats.marketCap)} />
                    <StatRow label="52W High" value={formatPrice(stats.high52w)} />
                    <StatRow label="52W Low" value={formatPrice(stats.low52w)} />
                    <StatRow label="Volume" value={formatLarge(stats.volume)} />
                    <StatRow label="Avg Volume" value={formatLarge(stats.avgVolume)} />
                    <StatRow label="P/E Ratio" value={stats.peRatio != null ? stats.peRatio.toFixed(2) : "-"} />
                    <StatRow label="EPS" value={stats.eps != null ? formatPrice(stats.eps) : "-"} />
                    <StatRow label="Previous Close" value={formatPrice(stats.previousClose)} />
                    <StatRow label="Open" value={formatPrice(stats.open)} />
                    <StatRow label="Exchange" value={stats.exchange || "-"} />
                    {stats.sector && <StatRow label="Sector" value={stats.sector} />}
                    {stats.beta != null && <StatRow label="Beta" value={stats.beta.toFixed(2)} />}
                  </>
                )}
              </div>
            ) : (
              <div className="text-gray-500 text-sm py-4">Stats unavailable</div>
            )}
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              {side === "buy" ? "Buy" : "Sell"} {normalizedSymbol}
            </h3>

            {currentPrice != null && (
              <div className="flex justify-between text-sm mb-3 pb-2 border-b border-gray-800">
                <span className="text-gray-400">Current Price</span>
                <span className="font-mono text-emerald-400 font-medium">{formatPrice(currentPrice)}</span>
              </div>
            )}

            {summary && (
              <div className="flex justify-between text-xs mb-3 text-gray-500">
                <span>Available {cashLabel}</span>
                <span className="font-mono">{formatPrice(cashAvailable)}</span>
              </div>
            )}

            {orderError && <div className="bg-red-900/50 text-red-300 text-sm p-2 rounded mb-3">{orderError}</div>}
            {orderResult && (
              <div className="bg-emerald-900/50 text-emerald-300 text-sm p-2 rounded mb-3">
                Order {orderResult.status}! ID: {orderResult.id.slice(0, 8)}...
              </div>
            )}

            <form onSubmit={handlePlaceOrder} className="space-y-3">
              <div className="flex gap-2">
                <button type="button" onClick={() => setSide("buy")}
                  className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${side === "buy" ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Buy</button>
                <button type="button" onClick={() => setSide("sell")}
                  className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${side === "sell" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Sell</button>
              </div>

              <select value={orderType} onChange={(e) => setOrderType(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500">
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop_loss">Stop Loss</option>
                <option value="bracket">Bracket</option>
              </select>

              <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} required min="1" step="1"
                placeholder="Quantity"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500" />

              {(orderType === "limit" || orderType === "bracket") && (
                <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} required step="0.01"
                  placeholder="Limit Price"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500" />
              )}

              {(orderType === "stop_loss" || orderType === "bracket") && (
                <input type="number" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} required step="0.01"
                  placeholder="Stop Price"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500" />
              )}

              {orderType === "bracket" && (
                <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} required step="0.01"
                  placeholder="Target Price"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500" />
              )}

              <button type="submit" disabled={submitting}
                className={`w-full py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 ${
                  side === "buy"
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "bg-red-600 hover:bg-red-500 text-white"
                }`}>
                {submitting ? "Placing..." : `${side === "buy" ? "Buy" : "Sell"} ${normalizedSymbol}`}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
