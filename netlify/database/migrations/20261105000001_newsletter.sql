-- TrailBook News, the weekly newsletter Pomeroy Agency sends to people who
-- signed up for it. These tables belong to TrailBook itself, not to any
-- customer's books: they have no org_id, and the tenant role (altqbo_app) is
-- given no access, so only the system connection reads or writes them, from
-- the scheduled jobs and from the Newsletter page in the operator's own
-- organisation (NEWSLETTER_ORG_ID).
--
-- The pipeline: a daily job reads news feeds into news_items and scores them;
-- notable ones get their facts written up by Claude. Each Monday a draft issue
-- is written from those facts and from the team's notes. A person edits it,
-- sends themselves a test and approves it; only then is it scheduled in Brevo.

-- When each feed last answered, so a dead feed shows on the page.
CREATE TABLE news_sources_status (
  source_id        text PRIMARY KEY,
  last_checked_at  timestamptz NOT NULL,
  last_ok_at       timestamptz,
  last_error       text,
  items_last_seen  integer NOT NULL DEFAULT 0
);

CREATE TABLE newsletter_issues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Tuesday it goes out (Pacific time). One issue per week.
  send_on            date NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'discarded')),
  subject            text NOT NULL CHECK (length(subject) BETWEEN 1 AND 150),
  preheader          text NOT NULL CHECK (length(preheader) <= 250),
  -- { intro, sections: [{ kind, heading, body, link, itemId, noteId }], closing }
  content            jsonb NOT NULL,
  drafted_by         text NOT NULL CHECK (drafted_by IN ('claude', 'template')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text,
  brevo_campaign_id  bigint,
  last_test_at       timestamptz,
  last_test_to       text,
  approved_by        text,
  approved_at        timestamptz,
  send_at            timestamptz,
  sent_at            timestamptz,
  -- A scheduled issue was approved by someone, for a time, in Brevo.
  CHECK (status NOT IN ('scheduled', 'sent') OR (approved_by IS NOT NULL AND send_at IS NOT NULL AND brevo_campaign_id IS NOT NULL))
);

CREATE TABLE news_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     text NOT NULL,
  url           text NOT NULL UNIQUE CHECK (length(url) <= 2000),
  title         text NOT NULL,
  -- The title reduced to its words, so the same story from two feeds is kept once.
  title_key     text NOT NULL,
  published_at  timestamptz,
  found_at      timestamptz NOT NULL DEFAULT now(),
  -- The feed's own short summary. Article text is never stored.
  excerpt       text NOT NULL DEFAULT '',
  score         integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons       text[] NOT NULL DEFAULT '{}',
  -- Claude's write-up in our own words: headline, summary, who, when, what to do.
  facts         jsonb,
  facts_at      timestamptz,
  facts_error   text,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'used', 'dismissed')),
  issue_id      uuid REFERENCES newsletter_issues(id)
);
CREATE INDEX news_items_found ON news_items (found_at DESC);
CREATE INDEX news_items_title_key ON news_items (title_key);

-- What the team wants in the next issue: TrailBook updates and sales tips.
CREATE TABLE newsletter_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('update', 'tip')),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  link        text CHECK (link IS NULL OR length(link) <= 2000),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  issue_id    uuid REFERENCES newsletter_issues(id),
  removed_at  timestamptz
);
