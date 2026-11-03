"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import MarketChart from "./market-chart";
import Launchpad from "./launchpad";
import WalletPanel from "./wallet-panel";
import { useReference } from "./live-market";

type Market = {
  symbol: string;
  base_asset: string;
  reference_price: string;
  last_price: string | null;
  volume: string;
  quantity_step: string;
  price_tick: string;
};
type Level = { price: string; quantity: string };
type Trade = {
  id: number;
  price: string;
  quantity: string;
  created_at: string;
};
type Book = {
  symbol: string;
  bids: Level[];
  asks: Level[];
  trades: Trade[];
  sequence: number;
};
type Order = {
  id: string;
  symbol: string;
  side: string;
  order_type: string;
  price: string;
  quantity: string;
  remaining: string;
  state: string;
};
type Balance = {
  wallet: string;
  asset: string;
  available: string;
  held: string;
};
type Subscription = {
  id: string;
  asset: string;
  principal: string;
  state: string;
};
type History = {
  id: number;
  kind: string;
  asset: string;
  amount: string;
  wallet: string;
  bucket: string;
  created_at: string;
};
type Account = {
  user: { id: string; handle: string };
  balances: Balance[];
  orders: Order[];
  fills: (Trade & {
    symbol: string;
    side: string;
    buyer_fee: string;
    seller_fee: string;
  })[];
  subscriptions: Subscription[];
  history: History[];
};
type View = "trade" | "markets" | "assets" | "earn" | "launchpad";
type PendingCommand = { key: string; fingerprint: string };
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      "Connection lost. Check order status before retrying; the same command ID will be retained.",
      503,
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || "Request failed", response.status);
  return data;
}
const num = (value: string | number | undefined, decimals = 2) =>
  Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
const short = (value: string) =>
  value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
const coins: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◎",
  USDT: "₮",
};
const names: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  USDT: "Tether",
};
function Coin({ asset }: { asset: string }) {
  return (
    <span className={`coin coin-${asset.toLowerCase()}`}>
      {coins[asset] || asset[0]}
    </span>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">≡</span>
      <p>{children}</p>
    </div>
  );
}

export default function Workspace() {
  const [view, setView] = useState<View>("trade"),
    [symbol, setSymbol] = useState("BTCUSDT");
  const navigate = (next: View) => {
    if (window.location.hash !== `#${next}`)
      window.history.pushState(null, "", `#${next}`);
    setView(next);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const restore = () => {
      const next = window.location.hash.slice(1) as View;
      setView(
        ["trade", "markets", "assets", "earn", "launchpad"].includes(next)
          ? next
          : "trade",
      );
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);
  const reference = useReference(symbol);
  const [bookSource, setBookSource] = useState<"reference" | "sandbox">(
    "reference",
  );
  const [markets, setMarkets] = useState<Market[]>([]),
    [book, setBook] = useState<Book | null>(null),
    [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "stale">(
    "connecting",
  );
  const [notice, setNotice] = useState(""),
    [authOpen, setAuthOpen] = useState(false),
    [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState(""),
    [password, setPassword] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [side, setSide] = useState("BUY"),
    [type, setType] = useState("LIMIT"),
    [tif, setTif] = useState("GTC"),
    [price, setPrice] = useState("65010"),
    [quantity, setQuantity] = useState("0.001");
  const [historyTab, setHistoryTab] = useState("Open orders"),
    [search, setSearch] = useState(""),
    [transferOpen, setTransferOpen] = useState(false);
  const [transferAsset, setTransferAsset] = useState("USDT"),
    [transferAmount, setTransferAmount] = useState("100"),
    [transferFrom, setTransferFrom] = useState("SPOT");
  useEffect(() => {
    if (authOpen || transferOpen) setNotice("");
  }, [authOpen, transferOpen]);
  const [earnAsset, setEarnAsset] = useState("USDT"),
    [earnAmount, setEarnAmount] = useState("100");
  const pendingMutations = useRef(new Map<string, string>());
  const pending = useRef<PendingCommand | null>(null),
    authEpoch = useRef(0),
    busyRef = useRef(false),
    noticeRef = useRef<HTMLDivElement>(null);
  const market = markets.find((m) => m.symbol === symbol),
    base = market?.base_asset || symbol.replace("USDT", "");
  const refreshAccount = useCallback(async () => {
    const epoch = authEpoch.current;
    try {
      const a = await api<Account>("account");
      if (epoch === authEpoch.current) setAccount(a);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 401 &&
        epoch === authEpoch.current
      )
        setAccount(null);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [m, b] = await Promise.all([
          api<Market[]>("markets"),
          api<Book>(`book/${symbol}`),
        ]);
        if (!cancelled) {
          setMarkets(
            m.filter((market) =>
              ["BTCUSDT", "ETHUSDT"].includes(market.symbol),
            ),
          );
          setBook(b);
          setStatus("live");
        }
      } catch {
        if (!cancelled) setStatus("stale");
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    }
    setBook(null);
    setStatus("connecting");
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol]);
  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);
  const userId = account?.user.id;
  useEffect(() => {
    pending.current = null;
    if (!userId) return;
    try {
      const saved = sessionStorage.getItem(`lc.pending.v1.${userId}`);
      if (!saved) return;
      const candidate = JSON.parse(saved) as PendingCommand;
      if (
        !/^[a-zA-Z0-9_-]{8,64}$/.test(candidate.key) ||
        typeof candidate.fingerprint !== "string"
      )
        return;
      const request = JSON.parse(candidate.fingerprint);
      if (
        !["symbol", "side", "type", "timeInForce", "price", "quantity"].every(
          (k) => typeof request[k] === "string",
        )
      )
        return;
      pending.current = candidate;
      setSymbol(request.symbol);
      setSide(request.side);
      setType(request.type);
      setTif(request.timeInForce);
      setPrice(request.price);
      setQuantity(request.quantity);
      setNotice(
        "Unconfirmed order restored. Check its status or retry the original command.",
      );
    } catch {
      setNotice(
        "Saved order recovery data is unavailable. Review your order history before placing another order.",
      );
    }
  }, [userId]);
  function savePending(value: PendingCommand | null) {
    if (userId) {
      const key = `lc.pending.v1.${userId}`;
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    }
    pending.current = value;
  }
  async function sendPending() {
    const command = pending.current;
    if (!command) return;
    const request = JSON.parse(command.fingerprint);
    try {
      const order = await api<Order>("orders", "POST", {
        ...request,
        commandId: command.key,
      });
      savePending(null);
      setNotice(
        `${order.side} order ${order.state.toLowerCase().replaceAll("_", " ")} · ${order.id.slice(0, 8)}`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) savePending(null);
      throw e;
    }
  }
  async function lookUpPending() {
    const command = pending.current;
    if (!command) return;
    await run(async () => {
      const result = await api<{ found: boolean; order?: Order }>(
        `commands/${command.key}`,
      );
      if (result.found && result.order?.id) {
        savePending(null);
        setNotice(
          `Order recovered: ${result.order.state.toLowerCase().replaceAll("_", " ")} · ${result.order.id.slice(0, 8)}`,
        );
      } else
        setNotice(
          "No committed result found yet. Retrying the original command is safe.",
        );
    });
  }
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  function selectSymbol(m: Market) {
    if (pending.current) {
      setNotice("Resolve the pending order before changing markets.");
      return;
    }
    setSymbol(m.symbol);
    setPrice(short(m.last_price || m.reference_price));
    setQuantity(
      m.base_asset === "BTC" ? "0.001" : m.base_asset === "ETH" ? "0.01" : "1",
    );
    navigate("trade");
  }
  async function run(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      await operation();
      await refreshAccount();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Request failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function openAuthentication(create = false) {
    setRegister(create);
    setHandle(create ? "" : "qcex_demo");
    setPassword(create ? "" : "QCEX_Demo_2026!");
    setDemoCode(create ? "" : "123456");
    setNotice("");
    setAuthOpen(true);
  }
  async function authenticate(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api(`auth/${register ? "register" : "login"}`, "POST", {
        handle,
        password,
        demoCode,
      });
      authEpoch.current++;
      setAuthOpen(false);
      setPassword("");
      setDemoCode("");
      setNotice(
        register
          ? "Sandbox account created. Your test assets are ready."
          : "Signed in.",
      );
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!account) {
      openAuthentication();
      return;
    }
    const request = {
      symbol,
      side,
      type,
      timeInForce: type === "MARKET" ? "IOC" : tif,
      price,
      quantity,
    };
    const fingerprint = JSON.stringify(request);
    if (pending.current && pending.current.fingerprint !== fingerprint) {
      setNotice(
        "Resolve your earlier submission before changing the order. Restore its inputs and retry.",
      );
      return;
    }
    const commandId = pending.current?.key || crypto.randomUUID();
    try {
      savePending({ key: commandId, fingerprint });
    } catch {
      setNotice("Order was not sent: browser recovery storage is unavailable.");
      return;
    }
    await run(sendPending);
  }
  async function writeCommand(path: string, body: Record<string, unknown>) {
    const fingerprint = path + "|" + JSON.stringify(body);
    const commandId =
      pendingMutations.current.get(fingerprint) || crypto.randomUUID();
    pendingMutations.current.set(fingerprint, commandId);
    try {
      const result = await api(path, "POST", { ...body, commandId });
      pendingMutations.current.delete(fingerprint);
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status < 500)
        pendingMutations.current.delete(fingerprint);
      throw e;
    }
  }
  async function mutate(
    path: string,
    method: string,
    body?: Record<string, unknown>,
    message = "Completed",
  ) {
    await run(async () => {
      if (body) await writeCommand(path, body);
      else await api(path, method);
      setNotice(message);
    });
  }
  const available = (asset: string, wallet = "SPOT") =>
    account?.balances.find((b) => b.asset === asset && b.wallet === wallet)
      ?.available || "0";
  const filtered = markets.filter(
    (m) =>
      m.symbol.toLowerCase().includes(search.toLowerCase()) ||
      names[m.base_asset]?.toLowerCase().includes(search.toLowerCase()),
  );
  const openOrders =
    account?.orders.filter((o) =>
      ["NEW", "PARTIALLY_FILLED"].includes(o.state),
    ) || [];
  const localPrice = market?.last_price || market?.reference_price || "0";
  const displayPrice = reference?.ticker?.price;
  const shownBook = bookSource === "reference" ? reference?.book : book;
  const quote = (pair: string) =>
    reference?.markets.find((m) => m.symbol === pair);
  const chooseBookPrice = (value: string) => {
    if (bookSource === "sandbox") setPrice(short(value));
    else
      setNotice(
        "Binance depth is reference data. Choose Sandbox book to select an executable QCEX price.",
      );
  };
  return (
    <div className="app-shell">
      <header className="global-header">
        <button
          className="brand"
          onClick={() => navigate("trade")}
          aria-label="QCEX home"
        >
          <span className="brand-mark">Q</span>Q<span>CEX</span>
        </button>
        <nav aria-label="Main navigation">
          {(
            [
              ["markets", "Markets"],
              ["trade", "Trade"],
              ["earn", "Earn"],
              ["launchpad", "LaunchPad"],
              ["assets", "Assets"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={view === v ? "active" : ""}
              aria-current={view === v ? "page" : undefined}
              onClick={() => navigate(v)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="sandbox-badge">SANDBOX</span>
          {account ? (
            <>
              <span className="user-handle">{account.user.handle}</span>
              <button
                className="quiet"
                onClick={() =>
                  void run(async () => {
                    await api("auth/logout", "POST");
                    authEpoch.current++;
                    setAccount(null);
                    setNotice("Signed out.");
                  })
                }
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <button
                className="quiet"
                onClick={() => {
                  openAuthentication();
                }}
              >
                Log in
              </button>
              <button
                className="primary compact"
                onClick={() => {
                  openAuthentication(true);
                }}
              >
                Create account
              </button>
            </>
          )}
        </div>
      </header>
      <div className="environment-strip">
        <span className="dot" /> Development preview{" "}
        <span className="strip-divider">|</span> Synthetic assets only{" "}
        <span className="strip-divider">|</span> Spot engine connected to a
        local order book · Binance reference data{" "}
        <span className="strip-right">QCEX v0.2</span>
      </div>
      {pending.current && account && (
        <div className="notice recovery-notice">
          <span>Unconfirmed order · {pending.current.key.slice(0, 8)}</span>
          <button
            disabled={busy}
            className="text-button"
            onClick={() => void lookUpPending()}
          >
            Check order status
          </button>
          <button
            disabled={busy}
            className="text-button"
            onClick={() => void run(sendPending)}
          >
            Retry original order
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status" tabIndex={-1} ref={noticeRef}>
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {view === "trade" && (
        <main>
          <div className="product-tabs">
            <span className="selected">Spot</span>
            <span title="Not implemented yet">
              Margin <small>Planned</small>
            </span>
            <span title="Not implemented yet">
              Futures <small>Planned</small>
            </span>
            <span className="product-end">0.10% maker / taker fee</span>
          </div>
          <section className="market-strip">
            <div className="market-name">
              <Coin asset={base} />
              <div>
                <h1>
                  {base}
                  <span>/USDT</span>
                </h1>
                <small>{names[base]}</small>
              </div>
            </div>
            <div className="current-price">
              {displayPrice ? num(displayPrice) : "—"}
              <small>
                Binance ·{" "}
                {reference?.status === "live"
                  ? "Live reference"
                  : "Stale / connecting"}
              </small>
            </div>
            <label className="pair-picker">
              Trading pair
              <select
                aria-label="Trading pair"
                value={symbol}
                onChange={(e) => {
                  const selected = markets.find(
                    (m) => m.symbol === e.target.value,
                  );
                  if (selected) selectSymbol(selected);
                }}
              >
                <option value="BTCUSDT">BTC / USDT</option>
                <option value="ETHUSDT">ETH / USDT</option>
              </select>
            </label>
            <div className="market-stat">
              <small>Binance 24h volume</small>
              <strong>
                {reference?.ticker ? num(reference.ticker.volume, 2) : "—"}{" "}
                <em>{base}</em>
              </strong>
            </div>
            <div className="market-stat">
              <small>24h change</small>
              <strong
                className={
                  Number(reference?.ticker?.change || 0) >= 0
                    ? "positive"
                    : "negative"
                }
              >
                {reference?.ticker ? `${num(reference.ticker.change)}%` : "—"}
              </strong>
            </div>
            <div className="market-stat">
              <small>24h high / low</small>
              <strong>
                {reference?.ticker
                  ? `${num(reference.ticker.high)} / ${num(reference.ticker.low)}`
                  : "—"}
              </strong>
            </div>
          </section>
          <div className="terminal-grid">
            <section className="panel orderbook">
              <div className="panel-heading">
                <h2>Order Book</h2>
                <span
                  className={
                    bookSource === "reference" && reference?.status !== "live"
                      ? "negative"
                      : "positive"
                  }
                >
                  {bookSource === "reference"
                    ? reference?.status || "connecting"
                    : status}
                </span>
              </div>
              <div className="book-source">
                <button
                  aria-pressed={bookSource === "reference"}
                  onClick={() => setBookSource("reference")}
                >
                  Binance reference
                </button>
                <button
                  aria-pressed={bookSource === "sandbox"}
                  onClick={() => setBookSource("sandbox")}
                >
                  Sandbox book
                </button>
              </div>
              <div className="book-columns">
                <span>Price (USDT)</span>
                <span>Amount ({base})</span>
                <span>Total</span>
              </div>
              <div className="book-levels asks">
                {[...(shownBook?.asks || [])].slice(0, 16).map((l) => (
                  <BookRow
                    key={l.price}
                    level={l}
                    max={Math.max(
                      ...(shownBook?.asks || []).map((a) => Number(a.quantity)),
                      1,
                    )}
                    side="ask"
                    onSelect={() => chooseBookPrice(l.price)}
                  />
                ))}
              </div>
              <div className="book-mid">
                <strong>
                  {bookSource === "reference"
                    ? displayPrice
                      ? num(displayPrice)
                      : "—"
                    : num(localPrice)}
                </strong>
                <span>
                  {bookSource === "reference"
                    ? "Binance · not executable here"
                    : "QCEX · synthetic funds"}
                </span>
              </div>
              <div className="book-levels bids">
                {shownBook?.bids.slice(0, 16).map((l) => (
                  <BookRow
                    key={l.price}
                    level={l}
                    max={Math.max(
                      ...shownBook.bids.map((a) => Number(a.quantity)),
                      1,
                    )}
                    side="bid"
                    onSelect={() => chooseBookPrice(l.price)}
                  />
                ))}
              </div>
              {!shownBook && (
                <Empty>
                  {status === "stale"
                    ? "Market data unavailable"
                    : "Loading order book…"}
                </Empty>
              )}
              <div className="book-foot">
                {bookSource === "reference"
                  ? "Binance top 20 · reference depth"
                  : "Funded sandbox counterparties"}{" "}
                <span>●</span>
              </div>
            </section>
            <div className="center-column">
              <section className="panel chart-panel">
                <div className="panel-heading chart-heading">
                  <h2>Chart</h2>
                  <span className="muted">Binance spot · UTC</span>
                  <span className="chart-label">{base} / USDT</span>
                </div>
                <MarketChart
                  symbol={symbol}
                  epoch={`${reference?.epoch || 0}:${reference?.session || 0}`}
                  live={reference?.candles || {}}
                  status={reference?.status || "connecting"}
                />
              </section>
              <section className="panel ticket-panel">
                <div className="panel-heading">
                  <h2>Place sandbox order</h2>
                  <span className="muted">{base}/USDT</span>
                </div>
                <div className="ticket-body">
                  <form onSubmit={submit}>
                    <p className="execution-note">
                      Executes on QCEX only. Best local ask:{" "}
                      {book?.asks[0] ? num(book.asks[0].price) : "—"} USDT.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setBookSource("sandbox");
                          const level =
                            side === "BUY" ? book?.asks[0] : book?.bids[0];
                          if (level) setPrice(short(level.price));
                        }}
                      >
                        Use sandbox price
                      </button>
                    </p>
                    <div className="side-toggle">
                      <button
                        type="button"
                        className={side === "BUY" ? "buy selected" : ""}
                        onClick={() => setSide("BUY")}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        className={side === "SELL" ? "sell selected" : ""}
                        onClick={() => setSide("SELL")}
                      >
                        Sell
                      </button>
                    </div>
                    <div className="order-controls">
                      <label>
                        Order type
                        <select
                          aria-label="Order type"
                          value={type}
                          onChange={(e) => setType(e.target.value)}
                        >
                          <option value="LIMIT">Limit</option>
                          <option value="MARKET">Protected market</option>
                        </select>
                      </label>
                      {type === "LIMIT" && (
                        <label>
                          Time in force
                          <select
                            aria-label="Time in force"
                            value={tif}
                            onChange={(e) => setTif(e.target.value)}
                          >
                            <option>GTC</option>
                            <option>IOC</option>
                            <option>FOK</option>
                            <option value="POST">Post only</option>
                          </select>
                        </label>
                      )}
                    </div>
                    <div className="available">
                      Available{" "}
                      <strong>
                        {short(available(side === "BUY" ? "USDT" : base))}{" "}
                        {side === "BUY" ? "USDT" : base}
                      </strong>
                    </div>
                    <label className="amount-input">
                      <span>
                        {type === "MARKET" ? "Protection price" : "Price"}
                      </span>
                      <input
                        aria-label="Order price"
                        inputMode="decimal"
                        required
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                      <em>USDT</em>
                    </label>
                    <label className="amount-input">
                      <span>Amount</span>
                      <input
                        aria-label="Order amount"
                        inputMode="decimal"
                        required
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                      <em>{base}</em>
                    </label>
                    <div className="order-estimate">
                      <span>Estimated notional</span>
                      <strong>
                        ≈ {num(Number(price) * Number(quantity))} USDT
                      </strong>
                    </div>
                    <button
                      disabled={busy || status !== "live"}
                      className={`trade-button ${side.toLowerCase()}`}
                    >
                      {busy
                        ? "Submitting…"
                        : account
                          ? `${side === "BUY" ? "Buy" : "Sell"} ${base}`
                          : "Log in or create account"}
                    </button>
                  </form>
                  <aside className="ticket-help">
                    <span className="eyebrow">TRADE WITH CLARITY</span>
                    <h3>
                      Your assets.
                      <br />
                      Every movement accounted for.
                    </h3>
                    <p>
                      Orders reserve available funds. Executions settle against
                      other funded accounts in this sandbox.
                    </p>
                    <dl>
                      <div>
                        <dt>Trading fee</dt>
                        <dd>0.10% per fill</dd>
                      </div>
                      <div>
                        <dt>Settlement</dt>
                        <dd>Atomic</dd>
                      </div>
                      <div>
                        <dt>Market orders</dt>
                        <dd>Protected IOC</dd>
                      </div>
                    </dl>
                    <button
                      className="text-button"
                      onClick={() => navigate("assets")}
                    >
                      View your assets ↗
                    </button>
                  </aside>
                </div>
              </section>
            </div>
            <aside className="right-column">
              <section className="panel markets-panel">
                <label className="search-input">
                  <span>⌕</span>
                  <input
                    aria-label="Search markets"
                    placeholder="Search markets"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="mini-tabs">
                  <strong>USDT</strong>
                  <span>2 live reference markets</span>
                </div>
                <div className="market-columns">
                  <span>Pair</span>
                  <span>Binance last</span>
                </div>
                {filtered.map((m) => (
                  <button
                    key={m.symbol}
                    className={`market-row ${symbol === m.symbol ? "selected" : ""}`}
                    onClick={() => selectSymbol(m)}
                  >
                    <span>
                      ☆ &nbsp;{m.base_asset}
                      <small>/USDT</small>
                    </span>
                    <strong
                      className={
                        quote(m.symbol)?.status === "live" ? "" : "muted"
                      }
                    >
                      {quote(m.symbol)?.ticker
                        ? num(quote(m.symbol)!.ticker!.price)
                        : "—"}
                    </strong>
                  </button>
                ))}
              </section>
              <section className="panel trades-panel">
                <div className="panel-heading">
                  <h2>Market Trades</h2>
                  <span className="muted">Binance · reference</span>
                </div>
                <div className="trade-columns">
                  <span>Price (USDT)</span>
                  <span>Amount</span>
                  <span>Time</span>
                </div>
                {reference?.trades.slice(0, 17).map((t) => (
                  <div className="trade-row" key={t.id}>
                    <strong
                      className={t.side === "BUY" ? "positive" : "negative"}
                    >
                      {num(t.price)}
                    </strong>
                    <span>{short(t.quantity)}</span>
                    <time>{new Date(t.time).toISOString().slice(11, 19)}</time>
                  </div>
                ))}
                {!reference?.trades.length && (
                  <Empty>
                    Waiting for Binance trades.
                    <br />
                    Your fills appear in Trade history.
                  </Empty>
                )}
              </section>
            </aside>
          </div>
          <section className="panel history-panel">
            <div className="history-tabs">
              {["Open orders", "Order history", "Trade history"].map((t) => (
                <button
                  key={t}
                  className={historyTab === t ? "active" : ""}
                  onClick={() => setHistoryTab(t)}
                >
                  {t}
                  {t === "Open orders" && ` (${openOrders.length})`}
                </button>
              ))}
              <button
                className="refresh-button"
                onClick={() => void refreshAccount()}
              >
                Refresh ↻
              </button>
            </div>
            {!account ? (
              <Empty>
                <button
                  className="text-button"
                  onClick={() => openAuthentication()}
                >
                  Sign in
                </button>{" "}
                to view your orders.
              </Empty>
            ) : historyTab === "Trade history" ? (
              <div className="table-scroll">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Pair</th>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Quantity</th>
                      <th>Fee (USDT)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.fills.map((f) => (
                      <tr key={f.id}>
                        <td>{f.created_at}</td>
                        <td>{f.symbol}</td>
                        <td
                          className={f.side === "BUY" ? "positive" : "negative"}
                        >
                          {f.side}
                        </td>
                        <td>{num(f.price)}</td>
                        <td>{short(f.quantity)}</td>
                        <td>
                          {short(f.side === "BUY" ? f.buyer_fee : f.seller_fee)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!account.fills.length && <Empty>No fills yet</Empty>}
              </div>
            ) : (
              <OrderTable
                orders={
                  historyTab === "Open orders" ? openOrders : account.orders
                }
                busy={busy}
                cancel={(id) =>
                  void mutate(
                    `orders/${id}`,
                    "DELETE",
                    undefined,
                    "Order canceled; residual funds released.",
                  )
                }
              />
            )}
          </section>
        </main>
      )}
      {view === "markets" && (
        <main className="content-page">
          <span className="eyebrow">EXPLORE THE EXCHANGE</span>
          <h1>Markets</h1>
          <p className="page-subtitle">
            Two live Binance reference markets. Trade with synthetic funds on
            the QCEX sandbox book.
          </p>
          <div className="market-cards">
            {markets.map((m) => (
              <button
                key={m.symbol}
                className="panel market-card"
                onClick={() => selectSymbol(m)}
              >
                <Coin asset={m.base_asset} />
                <h2>
                  {names[m.base_asset]} <span>{m.base_asset}</span>
                </h2>
                <strong>
                  {quote(m.symbol)?.ticker
                    ? num(quote(m.symbol)!.ticker!.price)
                    : "—"}{" "}
                  <small>USDT</small>
                </strong>
                <p>
                  Binance reference · {quote(m.symbol)?.status || "connecting"}
                </p>
                <span className="text-button">Trade {m.base_asset} ↗</span>
              </button>
            ))}
          </div>
          <div className="panel table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Binance reference price</th>
                  <th>Binance 24h volume</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.symbol}>
                    <td>
                      {m.base_asset}{" "}
                      <span className="muted">{names[m.base_asset]}</span>
                    </td>
                    <td>
                      {quote(m.symbol)?.ticker
                        ? num(quote(m.symbol)!.ticker!.price)
                        : "—"}{" "}
                      USDT
                    </td>
                    <td>
                      {quote(m.symbol)?.ticker
                        ? num(quote(m.symbol)!.ticker!.volume, 2)
                        : "—"}{" "}
                      {m.base_asset}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => selectSymbol(m)}
                      >
                        Trade
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      )}
      {view === "assets" && (
        <main className="content-page">
          <div className="page-title">
            <div>
              <span className="eyebrow">YOUR ACCOUNT</span>
              <h1>Assets</h1>
              <p className="page-subtitle">
                Available, reserved and product balances, kept separate.
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                account ? setTransferOpen(true) : openAuthentication()
              }
            >
              Transfer
            </button>
          </div>
          {!account ? (
            <Empty>
              Create an account to receive synthetic assets for testing.
              <br />
              <button className="primary" onClick={() => openAuthentication()}>
                Get started
              </button>
            </Empty>
          ) : (
            <>
              <WalletPanel revision={account.history[0]?.id} onChange={refreshAccount} />
              <h2 className="section-title">Ledger activity</h2>
              <div className="panel table-scroll">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Movement</th>
                      <th>Wallet / bucket</th>
                      <th>Asset</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.history.map((h) => (
                      <tr key={h.id}>
                        <td>{h.created_at}</td>
                        <td>{h.kind.replaceAll("_", " ")}</td>
                        <td>
                          {h.wallet} / {h.bucket}
                        </td>
                        <td>{h.asset}</td>
                        <td
                          className={
                            h.amount.startsWith("-") ? "negative" : "positive"
                          }
                        >
                          {h.amount.startsWith("-") ? "" : "+"}
                          {short(h.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      )}
      {view === "earn" && (
        <main className="content-page">
          <span className="eyebrow">QCEX EARN</span>
          <h1>Put your plans in motion.</h1>
          <p className="page-subtitle">
            Explore the subscription and redemption flow with synthetic assets.
          </p>
          <div className="earn-layout">
            <section className="panel earn-form">
              <span className="sandbox-badge">PRINCIPAL-ONLY PREVIEW</span>
              <h2>Flexible holding</h2>
              <p>
                Subscribe from your Spot wallet and redeem your principal at any
                time. This build does not accrue or promise rewards.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!account) {
                    openAuthentication();
                    return;
                  }
                  void mutate(
                    "earn",
                    "POST",
                    { asset: earnAsset, amount: earnAmount },
                    "Subscription created. Principal moved to Earn.",
                  );
                }}
              >
                <label>
                  Asset
                  <select
                    value={earnAsset}
                    onChange={(e) => setEarnAsset(e.target.value)}
                  >
                    {["USDT", "BTC", "ETH", "SOL"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    inputMode="decimal"
                    aria-label="Subscription amount"
                    value={earnAmount}
                    onChange={(e) => setEarnAmount(e.target.value)}
                    required
                  />
                </label>
                <div className="available">
                  Available{" "}
                  <strong>
                    {short(available(earnAsset))} {earnAsset}
                  </strong>
                </div>
                <button className="primary" disabled={busy}>
                  Subscribe
                </button>
              </form>
            </section>
            <section className="earn-explainer">
              <div className="step-number">01</div>
              <h2>Your principal stays traceable.</h2>
              <p>
                Subscription transfers funds between product accounts.
                Redemption returns them to Spot. Both movements appear in your
                ledger activity.
              </p>
              <dl>
                <div>
                  <dt>Reward accrual</dt>
                  <dd>Planned</dd>
                </div>
                <div>
                  <dt>Protocol staking</dt>
                  <dd>Planned</dd>
                </div>
                <div>
                  <dt>Redemption in this preview</dt>
                  <dd>Immediate</dd>
                </div>
              </dl>
            </section>
          </div>
          <h2 className="section-title">My subscriptions</h2>
          <div className="panel table-scroll">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Principal</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {account?.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.asset}</td>
                    <td>{short(s.principal)}</td>
                    <td>{s.state}</td>
                    <td>
                      {s.state === "ACTIVE" && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `earn/${s.id}/redeem`,
                              "POST",
                              undefined,
                              "Principal redeemed to Spot.",
                            )
                          }
                        >
                          Redeem
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!account?.subscriptions.length && (
              <Empty>No subscriptions yet</Empty>
            )}
          </div>
        </main>
      )}
      {view === "launchpad" && <Launchpad />}
      <footer className="footer">
        <span className={status === "live" ? "positive" : "negative"}>
          ●{" "}
          {status === "live"
            ? "Market snapshots connected"
            : status === "stale"
              ? "Market data stale"
              : "Connecting…"}
        </span>
        <span
          className={reference?.status === "live" ? "positive" : "negative"}
        >
          Binance {reference?.status || "connecting"} · live stream
        </span>
        <span className="footer-right">
          Synthetic funds · Development preview · Not a qualified exchange
          release
        </span>
      </footer>
      {authOpen && (
        <Modal
          title={register ? "Create sandbox account" : "Welcome back"}
          close={() => setAuthOpen(false)}
          error={notice}
        >
          <p className="modal-description">
            {register
              ? "Start with 100,000 synthetic USDT, 0.5 BTC, 5 ETH and 100 SOL."
              : "Demo details are ready. Sign in to explore, or enter your own account."}
          </p>
          <form onSubmit={authenticate}>
            <label>
              Username
              <input
                autoFocus
                autoComplete="username"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                minLength={3}
                maxLength={24}
                required
                pattern="[a-zA-Z0-9_]+"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
                maxLength={72}
                required
              />
            </label>
            {handle.toLowerCase() === "qcex_demo" && (
              <label>
                Demo verification code
                <input
                  value={demoCode}
                  onChange={(e) => setDemoCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  aria-describedby="demo-code-help"
                />
                <small id="demo-code-help">Use 123456. Fixed demo code; not real two-factor authentication.</small>
              </label>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
            </button>
            <button
              className="text-button auth-switch"
              type="button"
              onClick={() => openAuthentication(!register)}
            >
              {register
                ? "Already have an account? Log in"
                : "New here? Create an account"}
            </button>
          </form>
        </Modal>
      )}
      {transferOpen && (
        <Modal
          title="Transfer assets"
          close={() => setTransferOpen(false)}
          error={notice}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await writeCommand("transfers", {
                  asset: transferAsset,
                  amount: transferAmount,
                  from: transferFrom,
                  to: transferFrom === "SPOT" ? "FUNDING" : "SPOT",
                });
                setTransferOpen(false);
                setNotice("Transfer completed.");
              });
            }}
          >
            <label>
              From
              <select
                value={transferFrom}
                onChange={(e) => setTransferFrom(e.target.value)}
              >
                <option value="SPOT">Spot → Funding</option>
                <option value="FUNDING">Funding → Spot</option>
              </select>
            </label>
            <label>
              Asset
              <select
                value={transferAsset}
                onChange={(e) => setTransferAsset(e.target.value)}
              >
                {["USDT", "BTC", "ETH", "SOL"].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input
                aria-label="Transfer amount"
                inputMode="decimal"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                required
              />
            </label>
            <div className="available">
              Available{" "}
              <strong>
                {short(available(transferAsset, transferFrom))} {transferAsset}
              </strong>
            </div>
            <button className="primary" disabled={busy}>
              Confirm transfer
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BookRow({
  level,
  max,
  side,
  onSelect,
}: {
  level: Level;
  max: number;
  side: string;
  onSelect: () => void;
}) {
  return (
    <button
      className={`book-row ${side}`}
      style={{
        backgroundImage: `linear-gradient(to left, ${side === "bid" ? "rgba(14,203,129,.10)" : "rgba(246,70,93,.10)"} ${(Number(level.quantity) / max) * 85}%, transparent 0%)`,
      }}
      onClick={onSelect}
      title={`Use price ${level.price}`}
    >
      <strong>{num(level.price)}</strong>
      <span>{short(level.quantity)}</span>
      <span>{num(Number(level.price) * Number(level.quantity))}</span>
    </button>
  );
}
function OrderTable({
  orders,
  busy,
  cancel,
}: {
  orders: Order[];
  busy: boolean;
  cancel: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="app-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Type</th>
            <th>Side</th>
            <th>Price</th>
            <th>Amount</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.symbol}</td>
              <td>{o.order_type}</td>
              <td className={o.side === "BUY" ? "positive" : "negative"}>
                {o.side}
              </td>
              <td>{num(o.price)}</td>
              <td>{short(o.quantity)}</td>
              <td>{short(o.remaining)}</td>
              <td>{o.state.replaceAll("_", " ")}</td>
              <td>
                {["NEW", "PARTIALLY_FILLED"].includes(o.state) && (
                  <button
                    disabled={busy}
                    className="text-button"
                    onClick={() => cancel(o.id)}
                  >
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!orders.length && <Empty>No orders to display</Empty>}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  error,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={close} aria-label={title}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button onClick={close} aria-label="Close dialog">
          ×
        </button>
      </div>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
