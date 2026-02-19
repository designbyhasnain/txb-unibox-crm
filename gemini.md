# Project Context: TXB Unibox CRM

## Overview

A high-end, modern CRM and Cold Outreach platform inspired by Instantly.ai. The application features a premium, totally white design with lime green accents, a unified sidebar architecture, and a powerful "Unibox" for multi-account email management.

## Technical Stack

- **Frontend**: Vanilla JavaScript (ES Modules), Vite 6.
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, Migrations).
- **Styling**: Vanilla CSS with a centralized Variable-based system (`app.css`) and page-specific modules.
  - **Aesthetics**: Glassmorphism, subtle micro-animations (floating orbs), and high-contrast typography (Inter, Plus Jakarta Sans).
  - **Theme**: Light Professional (Background: `#FFFFFF`, Accent: Lime Green `#84CC16`).
- **Edge Functions**:
  - `gmail-auth-start`: Initiates OAuth 2.0 flow for Google.
  - `gmail-auth-callback`: Handles OAuth redirect and stores refresh tokens.
  - `fetch-gmail-emails`: Performs IMAP sync using `gmail-api` or `imapflow` to fetch real messages into the database.
  - `send-email`: Handles SMTP/Gmail API sending with support for threading (`threadId`, `inReplyTo`).

## Project Structure

- **/root**: Entry HTML pages (Vite entry points).
  - `index.html`: Main Dashboard.
  - `login.html`: Auth page.
  - `unibox.html`: Centralized inbox interface.
  - `campaigns.html` / `campaign.html`: Campaign management.
  - `accounts.html`: Email account configuration.
- **/src/pages**: Page-specific controllers and UI logic.
  - `unibox.js`: Complex state management for threads, filters, and global search (~75KB of logic).
  - `accounts.js`: OAuth flow handling and account status management.
  - `app.js`: Global sidebar and notification logic.
- **/src/lib**: Core shared utilities.
  - `supabase.js`: Supabase client initialization.
  - `auth.js`: Auth guards (`requireAuth`), session handling, and profile management.
- **/src/styles**: Design system and stylesheets.
  - `app.css`: Global variables, layout (sidebar), and shared components (buttons, cards, badges).
  - `unibox.css`, `campaigns.css`, etc.: Page-specific layout refinements.
- **/supabase**: Backend configuration.
  - `functions/`: Deno-based Edge Functions.
  - `migrations/`: Versioned SQL schema and RLS policies.

## Key Features & Logic

### 1. Unified App Navigation

A fixed, premium sidebar (`.app-shell`) used across all pages to ensure session persistence and consistent user flow. The sidebar maps to Status labels, Campaigns, and Inboxes.

### 2. The Unibox (Advanced)

- **Multi-Account Sync**: Syncs specific accounts or use "Sync All" to iterate through all connected Gmail accounts.
- **Unified History**: Shows both received replies and sent outreach logs in a chronologically sorted thread view.
- **Smart Filtering**:
  - **Folder Logic**: Inbox, Unread, Sent (fetched from `email_logs`).
  - **Label Logic**: Filter by Lead Status (Interested, Meeting Booked, Replied, etc.).
- **Global Search**: Search across _all_ connected accounts and thread histories simultaneously from the master inbox view.
- **Draft & Real-time**: Uses Supabase Realtime for instant message arrival and background sync (every 30s + on focus).

### 3. Professional Compose & Reply

- **Gmail-Clone Editor**: Rich text editing with a floating Apple-inspired "Pill" formatting toolbar.
- **Lead Autocomplete**: Search leads by name/email while composing to automatically link messages to existing leads.
- **Threading Support**: Correctly handles `Message-ID`, `References`, and `In-Reply-To` headers via Edge Functions for perfect conversation threading.

### 4. Gmail Integration (OAuth 2.0)

- Secure OAuth 2.0 flow for connecting Google accounts.
- Proactive token refresh logic in the frontend before sensitive API calls.
- Encrypted storage of refresh tokens in the `email_accounts` table.

### 5. Automation & Leads

- **Lead Status Flow**: Updating a lead to a terminal status (e.g., "Not Interested", "Won", "Unsubscribed") can be used to stop campaign sequences.
- **Real-time Stats**: Dashboard tiles showing active campaigns, reply rates, and sync status.

## Design Tokens (Reference)

- **Primary**: `#84CC16` (Lime)
- **Background**: `#FFFFFF` (Pure White)
- **Secondary BG**: `#FAFAFA`
- **Text Main**: `#1A1A1A`
- **Border**: `#F3F4F6`
- **Shadows**: Low-offset, natural shadows with subtle primary-colored glow on active states.

## Development Workflow

- **Dev**: `npm run dev` (Vite)
- **Database**: `supabase db push` / `supabase migration new`
- **Auth**: Profile-based `leads` and `email_accounts` tables linked via `user_id`.
