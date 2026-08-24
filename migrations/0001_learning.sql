PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  bucket5 INTEGER NOT NULL,
  source TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  sector TEXT,
  phase TEXT,
  price REAL NOT NULL,
  score REAL,
  crv REAL,
  rvol REAL,
  ret15 REAL,
  ret60 REAL,
  atr_pct REAL,
  liquidity_vacuum REAL,
  sector_lag REAL,
  crowd_score REAL,
  structure_pct REAL,
  light TEXT,
  max_pct REAL NOT NULL DEFAULT 0,
  min_pct REAL NOT NULL DEFAULT 0,
  success_ts INTEGER,
  resolved_ts INTEGER,
  payload TEXT,
  UNIQUE(source, asset_type, symbol, bucket5)
);

CREATE INDEX IF NOT EXISTS idx_snap_symbol_ts ON market_snapshots(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_snap_unresolved ON market_snapshots(resolved_ts, ts);
CREATE INDEX IF NOT EXISTS idx_snap_sector_resolved ON market_snapshots(sector, resolved_ts, ts DESC);

CREATE TABLE IF NOT EXISTS signal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  bucket5 INTEGER NOT NULL,
  signal TEXT NOT NULL,
  price REAL NOT NULL,
  strength REAL,
  source TEXT,
  UNIQUE(symbol, bucket5, signal)
);
CREATE INDEX IF NOT EXISTS idx_event_symbol_ts ON signal_events(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS crowd_cache (
  symbol TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  score REAL,
  stars INTEGER,
  accel REAL,
  interest REAL,
  source TEXT
);

CREATE TABLE IF NOT EXISTS fp_meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_ts INTEGER NOT NULL
);
