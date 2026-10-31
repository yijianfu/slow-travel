CREATE TABLE journals (
  owner TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  album TEXT NOT NULL,
  body TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE journal_photos (
  owner TEXT NOT NULL,
  album TEXT NOT NULL,
  id TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  retiring INTEGER NOT NULL DEFAULT 0 CHECK (retiring IN (0,1)),
  PRIMARY KEY (owner, album, id)
);
--> statement-breakpoint
CREATE TABLE journal_shares (
  token TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  album TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (owner, trip_id)
);
