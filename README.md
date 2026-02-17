# TXB UniBox CRM — Cold Outreach Tool

A cold outreach platform similar to [Instantly.ai](https://instantly.ai), built with **Supabase** (PostgreSQL).

## 🗄️ Database Schema

### Tables & Relationships

```
┌──────────┐       ┌────────────────┐       ┌────────────────────────┐
│  users   │──1:N──│ email_accounts │──M:N──│ campaign_email_accounts│
│          │       │                │       │                        │
│          │──1:N──│   campaigns    │──1:N──│                        │
└──────────┘       └────────────────┘       └────────────────────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
         ┌────▼────┐ ┌────▼────┐ ┌────▼──────┐
         │sequences│ │  leads  │ │email_logs │
         └─────────┘ └─────────┘ └───────────┘
                                       │
                               ┌───────▼────────┐
                               │  warmup_stats   │
                               └────────────────┘
```

### Table Summary

| Table                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `users`                   | App users who manage campaigns and accounts            |
| `email_accounts`          | Connected sender email accounts (Gmail/Outlook/SMTP)   |
| `campaigns`               | Email outreach campaigns                               |
| `campaign_email_accounts` | Many-to-many link: campaigns ↔ sender accounts         |
| `sequences`               | Ordered email steps within a campaign                  |
| `leads`                   | Recipient/prospect records with JSONB custom variables |
| `email_logs`              | Tracks every sent email for analytics                  |
| `warmup_stats`            | Daily warmup statistics per email account              |

### ENUMs

- **email_provider**: `Gmail` | `Outlook` | `SMTP`
- **email_account_status**: `Active` | `Warmup` | `Paused` | `Disconnected`
- **campaign_status**: `Draft` | `Running` | `Paused` | `Completed` | `Archived`
- **lead_status**: `Not Contacted` | `Contacted` | `Replied` | `Interested` | `Not Interested` | `Bounced` | `Unsubscribed`
- **email_log_status**: `Queued` | `Sent` | `Delivered` | `Opened` | `Clicked` | `Replied` | `Bounced` | `Failed`

## 🔐 Security

- **Row Level Security (RLS)** is enabled on all tables
- Each user can only access their own data via `auth.uid()` policies
- Cascading deletes ensure referential integrity

## 🚀 Getting Started

### Supabase Project

- **URL**: https://jkmfyuduxhkkrdxcfhbn.supabase.co
- **Region**: ap-southeast-2

### Local Development

```bash
# Migration file located at:
supabase/migrations/20260218_initial_cold_outreach_schema.sql

# TypeScript types at:
src/types/database.types.ts
```

## 📂 Project Structure

```
txb-unibox-crm/
├── README.md
├── supabase/
│   └── migrations/
│       └── 20260218_initial_cold_outreach_schema.sql
└── src/
    └── types/
        └── database.types.ts
```
