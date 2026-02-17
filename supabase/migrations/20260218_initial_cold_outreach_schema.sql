-- ============================================================
-- TXB UniBox CRM — Cold Outreach Schema (Instantly.ai-style)
-- Supabase Project: https://jkmfyuduxhkkrdxcfhbn.supabase.co
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────────────────────────────
-- 1. USERS — App users
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password      TEXT NOT NULL,
    avatar_url    TEXT,
    timezone      TEXT DEFAULT 'UTC',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS 'App users who manage campaigns, leads, and email accounts.';

-- ──────────────────────────────────────────────────────────────
-- 2. EMAIL_ACCOUNTS — Connected sender accounts
-- ──────────────────────────────────────────────────────────────
CREATE TYPE public.email_provider AS ENUM ('Gmail', 'Outlook', 'SMTP');
CREATE TYPE public.email_account_status AS ENUM ('Active', 'Warmup', 'Paused', 'Disconnected');

CREATE TABLE public.email_accounts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email_address       TEXT NOT NULL,
    display_name        TEXT,
    provider            public.email_provider NOT NULL DEFAULT 'SMTP',
    oauth_refresh_token TEXT,
    smtp_host           TEXT,
    smtp_port           INTEGER,
    smtp_username       TEXT,
    smtp_password       TEXT,
    imap_host           TEXT,
    imap_port           INTEGER,
    imap_username       TEXT,
    imap_password       TEXT,
    status              public.email_account_status NOT NULL DEFAULT 'Active',
    daily_limit         INTEGER NOT NULL DEFAULT 50,
    sent_count_today    INTEGER NOT NULL DEFAULT 0,
    warmup_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_accounts_user_id ON public.email_accounts(user_id);
CREATE INDEX idx_email_accounts_status  ON public.email_accounts(status);

COMMENT ON TABLE public.email_accounts IS 'Connected sender email accounts (Gmail, Outlook, custom SMTP).';

-- ──────────────────────────────────────────────────────────────
-- 3. CAMPAIGNS — Email campaigns
-- ──────────────────────────────────────────────────────────────
CREATE TYPE public.campaign_status AS ENUM ('Draft', 'Running', 'Paused', 'Completed', 'Archived');

CREATE TABLE public.campaigns (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    status        public.campaign_status NOT NULL DEFAULT 'Draft',
    total_leads   INTEGER NOT NULL DEFAULT 0,
    daily_limit   INTEGER DEFAULT 100,
    start_date    DATE,
    end_date      DATE,
    timezone      TEXT DEFAULT 'UTC',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user_id ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_status  ON public.campaigns(status);

COMMENT ON TABLE public.campaigns IS 'Email outreach campaigns with scheduling and status control.';

-- ──────────────────────────────────────────────────────────────
-- 4. CAMPAIGN_EMAIL_ACCOUNTS — Many-to-many link
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.campaign_email_accounts (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id      UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    email_account_id UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, email_account_id)
);

COMMENT ON TABLE public.campaign_email_accounts IS 'Links campaigns to the sender email accounts they rotate through.';

-- ──────────────────────────────────────────────────────────────
-- 5. SEQUENCES — Email steps within a campaign
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.sequences (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id   UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    step_number   INTEGER NOT NULL,
    subject       TEXT NOT NULL,
    email_body    TEXT NOT NULL,
    delay_days    INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, step_number)
);

CREATE INDEX idx_sequences_campaign_id ON public.sequences(campaign_id);

COMMENT ON TABLE public.sequences IS 'Ordered email steps (sequence) within a campaign. Each step fires after delay_days.';

-- ──────────────────────────────────────────────────────────────
-- 6. LEADS — Recipient data
-- ──────────────────────────────────────────────────────────────
CREATE TYPE public.lead_status AS ENUM (
    'Not Contacted', 'Contacted', 'Replied', 'Interested',
    'Not Interested', 'Bounced', 'Unsubscribed'
);

CREATE TABLE public.leads (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id       UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    email             TEXT NOT NULL,
    first_name        TEXT,
    last_name         TEXT,
    company           TEXT,
    title             TEXT,
    phone             TEXT,
    linkedin_url      TEXT,
    website           TEXT,
    custom_variables  JSONB DEFAULT '{}'::jsonb,
    status            public.lead_status NOT NULL DEFAULT 'Not Contacted',
    current_step      INTEGER NOT NULL DEFAULT 0,
    last_contacted_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_campaign_id ON public.leads(campaign_id);
CREATE INDEX idx_leads_status      ON public.leads(status);
CREATE INDEX idx_leads_email       ON public.leads(email);
CREATE UNIQUE INDEX idx_leads_campaign_email ON public.leads(campaign_id, email);

COMMENT ON TABLE public.leads IS 'Recipient/prospect records assigned to campaigns. Supports JSONB custom variables for personalization.';

-- ──────────────────────────────────────────────────────────────
-- 7. EMAIL_LOGS — Track every email sent
-- ──────────────────────────────────────────────────────────────
CREATE TYPE public.email_log_status AS ENUM (
    'Queued', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Replied', 'Bounced', 'Failed'
);

CREATE TABLE public.email_logs (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    lead_id           UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    campaign_id       UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    sequence_step_id  UUID NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
    email_account_id  UUID REFERENCES public.email_accounts(id) ON DELETE SET NULL,
    status            public.email_log_status NOT NULL DEFAULT 'Queued',
    message_id        TEXT,
    subject           TEXT,
    opened_at         TIMESTAMPTZ,
    clicked_at        TIMESTAMPTZ,
    replied_at        TIMESTAMPTZ,
    bounced_at        TIMESTAMPTZ,
    error_message     TEXT,
    sent_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_logs_user_id          ON public.email_logs(user_id);
CREATE INDEX idx_email_logs_lead_id          ON public.email_logs(lead_id);
CREATE INDEX idx_email_logs_campaign_id      ON public.email_logs(campaign_id);
CREATE INDEX idx_email_logs_sequence_step_id ON public.email_logs(sequence_step_id);
CREATE INDEX idx_email_logs_status           ON public.email_logs(status);
CREATE INDEX idx_email_logs_sent_at          ON public.email_logs(sent_at);
CREATE INDEX idx_email_logs_message_id       ON public.email_logs(message_id);

COMMENT ON TABLE public.email_logs IS 'Tracks every outbound email for analytics — open/click/reply/bounce tracking.';

-- ──────────────────────────────────────────────────────────────
-- 8. WARMUP_STATS — Daily warmup tracking per account
-- ──────────────────────────────────────────────────────────────
CREATE TABLE public.warmup_stats (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_account_id  UUID NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
    date              DATE NOT NULL,
    emails_sent       INTEGER NOT NULL DEFAULT 0,
    emails_received   INTEGER NOT NULL DEFAULT 0,
    emails_replied    INTEGER NOT NULL DEFAULT 0,
    landed_inbox      INTEGER NOT NULL DEFAULT 0,
    landed_spam       INTEGER NOT NULL DEFAULT 0,
    reputation_score  NUMERIC(5,2),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (email_account_id, date)
);

CREATE INDEX idx_warmup_stats_account_id ON public.warmup_stats(email_account_id);
CREATE INDEX idx_warmup_stats_date       ON public.warmup_stats(date);

COMMENT ON TABLE public.warmup_stats IS 'Daily warmup statistics per email account — inbox placement, reputation, etc.';

-- ──────────────────────────────────────────────────────────────
-- 9. AUTO-UPDATE TRIGGERS for updated_at columns
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_email_accounts_updated_at
    BEFORE UPDATE ON public.email_accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_campaigns_updated_at
    BEFORE UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_sequences_updated_at
    BEFORE UPDATE ON public.sequences
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────────────────────────
-- 10. ROW LEVEL SECURITY (RLS)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warmup_stats ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY users_own_data ON public.users
    FOR ALL USING (auth.uid() = id);

CREATE POLICY email_accounts_own_data ON public.email_accounts
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY campaigns_own_data ON public.campaigns
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY campaign_email_accounts_own_data ON public.campaign_email_accounts
    FOR ALL USING (
        campaign_id IN (SELECT id FROM public.campaigns WHERE user_id = auth.uid())
    );

CREATE POLICY sequences_own_data ON public.sequences
    FOR ALL USING (
        campaign_id IN (SELECT id FROM public.campaigns WHERE user_id = auth.uid())
    );

CREATE POLICY leads_own_data ON public.leads
    FOR ALL USING (
        campaign_id IN (SELECT id FROM public.campaigns WHERE user_id = auth.uid())
    );

CREATE POLICY email_logs_own_data ON public.email_logs
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY warmup_stats_own_data ON public.warmup_stats
    FOR ALL USING (
        email_account_id IN (SELECT id FROM public.email_accounts WHERE user_id = auth.uid())
    );
