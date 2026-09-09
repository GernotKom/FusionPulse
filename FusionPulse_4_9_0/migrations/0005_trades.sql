-- v3.28.0 · Handelstagebuch: Soll gegen Ist.
--
-- Bis hierher hat die App den MARKT gemessen, nicht den HÄNDLER. Jede
-- Lernschicht rechnete mit einem Phantom, das zum aufgezeichneten Preis kauft
-- und exakt am Ziel verkauft. Der Abstand zwischen diesem Phantom und einem
-- echten Menschen ist in aller Regel größer als der Vorteil, den die App zu
-- vermessen versucht: bei 1,02 % Stopweite sind zwei Zehntelprozent
-- Ausführungsabweichung ein Fünftel des Budgets.
--
-- Der Worker legt die Tabelle beim ersten Zugriff selbst an; diese Datei ist
-- die dokumentierte Fassung derselben Änderung.
CREATE TABLE IF NOT EXISTS trades(
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'stock',
  origin TEXT,
  plan_entry REAL, plan_target REAL, plan_stop REAL,
  plan_notional REAL, plan_net_eur REAL,
  fill_entry REAL, fill_entry_ts INTEGER,
  fill_exit REAL, fill_exit_ts INTEGER,
  real_net_eur REAL,
  skipped INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC);
