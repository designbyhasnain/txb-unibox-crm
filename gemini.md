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
  - `fetch-gmail-emails`: Performs IMAP sync using `imapflow` to fetch real messages into the database.

## Project Structure

- **/root**: Entry HTML pages (Vite entry points).
  - `index.html`: Main Dashboard.
  - `login.html`: Auth page.
  - `unibox.html`: Centralized inbox interface.
  - `campaigns.html` / `campaign.html`: Campaign management.
  - `accounts.html`: Email account configuration.
- **/src/pages**: Page-specific controllers and UI logic.
  - `unibox.js`: Complex state management for threads, filters, and global search.
  - `accounts.js`: OAuth flow handling and account status management.
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

A fixed, premium sidebar (`.app-shell`) used across all pages to ensure session persistence and consistent user flow.

### 2. The Unibox (Advanced)

- **Multi-Account Sync**: Syncs specific accounts or use "Sync All" to iterate through all connected Gmail accounts.
- **Smart Filtering**:
  - **Folder Logic**: Inbox, Unread, Sent (fetched from `email_logs`).
  - **Label Logic (Dropdown)**: Filter by Lead Status (Interested, Meeting Booked, Replied, etc.).
- **Global Search**: Search across _all_ connected accounts and thread histories simultaneously from the master inbox view.
- **Unified History**: Shows both received replies and sent outreach logs in a chronologically sorted thread view.
- **Lead Status Automation**: Updating a lead to a terminal status (e.g., "Not Interested", "Won", "Unsubscribed") automatically triggers an update that can be used to stop campaign sequences.

### 3. Gmail Integration (OAuth 2.0)

- Moved from legacy App Passwords to secure OAuth 2.0.
- Users click "Connect Google", authorize via Google's screen, and the app securely stores encrypted tokens for background IMAP/SMTP operations.

### 4. Dashboard Analytics

- Real-time stat cards for Campaigns, Leads, Emails Sent, and Reply Rate.
- "Quick Action" grid for rapid navigation.

## Design Tokens (Reference)

- **Primary**: `#84CC16` (Lime)
- **Background**: `#FFFFFF` (Pure White)
- **Secondary BG**: `#FAFAFA`
- **Text Main**: `#1A1A1A`
- **Border**: `#F3F4F6`
- **Shadows**: Low-offset, natural shadows with subtle primary-colored glow on active states.

## Future Roadmap (Implicit)

- **Sequence Builder**: Drag-and-drop outreach sequence creation.
- **Real-time Webhooks**: Move from poling/manual sync to real-time email notifications.
- **Advanced CRM**: Custom lead fields and automated task generation.
