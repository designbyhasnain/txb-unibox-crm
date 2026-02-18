import { requireAuth, getCurrentUser, signOut } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

/**
 * UniboxService — Handles data fetching and business logic for replies.
 */
class UniboxService {
  /**
   * Centralized message fetcher for Inbox, Sent, and Unified History.
   */
  static async fetchMessages(filters = {}) {
    const { 
      folder = "inbox", 
      email_account_id = null, 
      status = "all", 
      campaign_id = null, 
      search = "" 
    } = filters;

    // Unified History (Inbox + Sent) - Used for Account Detail View
    if (folder === "history") {
      const [inbox, sent] = await Promise.all([
        this.fetchMessages({ ...filters, folder: "inbox" }),
        this.fetchMessages({ ...filters, folder: "sent" })
      ]);
      // Sort combined by date descending
      return [...inbox, ...sent].sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
    }

    // Handle Sent Folder (from email_logs)
    if (folder === "sent") {
      let query = supabase
        .from("email_logs")
        .select(`
          *,
          lead:leads(*),
          campaign:campaigns(*),
          account:email_accounts(*)
        `)
        .eq("status", "Sent")
        .order("sent_at", { ascending: false });

      if (email_account_id) query = query.eq("email_account_id", email_account_id);
      
      if (search) {
        query = query.or(`subject.ilike.%${search}%,lead.email.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map(log => ({
        ...log,
        received_at: log.sent_at,
        is_read: true,
        from_email: log.account?.email_address || "Me",
        from_name: "Me",
        snippet: log.subject || "(No Subject)",
        type: 'sent'
      }));
    }

    // Handle Inbox/Replies
    let query = supabase
      .from("replies")
      .select(`
        *,
        lead:leads(*),
        campaign:campaigns(*),
        account:email_accounts(*)
      `)
      .order("received_at", { ascending: false });

    if (email_account_id) query = query.eq("email_account_id", email_account_id);
    if (campaign_id) query = query.eq("campaign_id", campaign_id);
    
    // Status filter (on lead)
    if (status && status !== "all") {
      query = query.eq("lead.status", status);
    }

    // Folder sub-filters
    if (folder === "unread") {
      query = query.eq("is_read", false);
    }

    // Global Search across all accounts
    if (search) {
      query = query.or(`from_email.ilike.%${search}%,subject.ilike.%${search}%,body_text.ilike.%${search}%,from_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(m => ({ ...m, type: 'received' }));
  }

  static async fetchThreadHistory(threadId, leadId) {
    if (!threadId && !leadId) return [];
    
    // Build OR conditions dynamically to avoid null syntax errors
    const orConditions = [];
    if (threadId) orConditions.push(`thread_id.eq.${threadId}`);
    if (leadId) orConditions.push(`lead_id.eq.${leadId}`);
    
    if (orConditions.length === 0) return [];

    // Fetch received replies
    const { data: replies, error: replyError } = await supabase
      .from("replies")
      .select("*")
      .or(orConditions.join(","))
      .order("received_at", { ascending: true });

    if (replyError) console.error("[UniboxService] fetchThreadHistory replies error:", replyError);

    // Fetch sent items from logs (Check both Lead ID and Thread ID for full coverage)
    let sentLogs = [];
    const sentConditions = [];
    if (leadId) sentConditions.push(`lead_id.eq.${leadId}`);
    if (threadId) sentConditions.push(`thread_id.eq.${threadId}`);

    if (sentConditions.length > 0) {
      const { data, error } = await supabase
        .from("email_logs")
        .select(`*, account:email_accounts(*)`)
        .or(sentConditions.join(","))
        .eq("status", "Sent")
        .order("sent_at", { ascending: true });
      
      if (error) console.error("[UniboxService] fetchThreadHistory sentLogs error:", error);
      else sentLogs = data || [];
    }

    // Combine and sort
    const history = [
      ...(replies || []).map(r => ({ ...r, type: 'received', timestamp: r.received_at })),
      ...(sentLogs || []).map(s => ({ 
        ...s, 
        type: 'sent', 
        timestamp: s.sent_at,
        from_name: 'Me',
        from_email: s.account?.email_address || 'Me',
        body_text: s.subject // In a real app, we'd fetch the full sent body
      }))
    ];

    return history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  static async updateLeadStatus(leadId, status) {
    const terminalStatuses = ['Not Interested', 'Lost', 'Out of office', 'Wrong person', 'Won', 'Unsubscribed'];
    const isStopping = terminalStatuses.includes(status);

    const { error } = await supabase
      .from("leads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", leadId);
      
    if (error) throw error;
    return isStopping;
  }

  static async markAsRead(replyId) {
    await supabase.from("replies").update({ is_read: true }).eq("id", replyId);
  }

  static async fetchCampaigns() {
    const { data } = await supabase.from("campaigns").select("id, name").order("name");
    return data || [];
  }

  static async fetchEmailAccounts() {
    const { data } = await supabase.from("email_accounts").select("id, email_address, status").order("email_address");
    return data || [];
  }
}

/**
 * UniboxUI — Handles DOM rendering and events.
 */
class UniboxUI {
  constructor() {
    this.elements = {
      threadList: document.getElementById("thread-list"),
      contentView: document.getElementById("unibox-content"),
      campaignFilters: document.getElementById("campaign-filters"),
      accountFilters: document.getElementById("account-filters"),
      searchInput: document.getElementById("thread-search"),
      globalSearch: document.getElementById("global-search"),
      globalSearchContainer: document.getElementById("global-search-container"),
      statusSearch: document.getElementById("status-search"),
      userName: document.getElementById("user-name"),
      userEmail: document.getElementById("user-email"),
      userAvatar: document.getElementById("user-avatar"),
      authLoading: document.getElementById("auth-loading"),
      appShell: document.getElementById("app-shell"),
      middlePaneTabs: document.getElementById("middle-pane-tabs"),
      refreshBtn: document.getElementById("refresh-account-btn")
    };
    
    this.activeFilters = { 
      folder: "inbox", 
      status: "all", 
      campaign_id: null, 
      email_account_id: null, 
      search: "" 
    };
    this.replies = [];
    this.selectedReply = null;
    this.isSyncing = false; // Add a lock to prevent overlapping syncs
  }

  async init(user) {
    if (this.elements.authLoading) this.elements.authLoading.hidden = true;
    if (this.elements.appShell) this.elements.appShell.hidden = false;
    
    const name = user.user_metadata?.name || user.email.split("@")[0];
    if (this.elements.userName) this.elements.userName.textContent = name;
    if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
    if (this.elements.userAvatar) this.elements.userAvatar.textContent = name[0].toUpperCase();

    // Start real-time listener
    this.setupRealtime();

    await this.refreshAll();
  }

  setupRealtime() {
    console.log("[UniboxUI] Setting up real-time sync...");
    
    // 1. Listen for new replies or logs in the database
    supabase
      .channel('unibox-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, () => {
        console.log("[UniboxUI] DB Check: New reply detected");
        this.refreshAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_logs' }, () => {
        console.log("[UniboxUI] DB Check: Sent log updated");
        this.refreshAll();
      })
      .subscribe();

    // Initial background sync run (Deep Sync: 50 messages to catch up)
    setTimeout(() => this.runBackgroundSyncList(50), 2000);

    // 2. Background Polling (Quick Sync: 10 messages every 10s)
    this.bgSyncInterval = setInterval(() => {
      this.runBackgroundSyncList(10);
    }, 10000); 

    // 3. Sync on Focus (immediate refresh when user returns to tab)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        console.log("[UniboxUI] Tab focused: Triggering quick sync...");
        this.runBackgroundSyncList();
      }
    });
  }

  async runBackgroundSyncList(limit = 10) {
    if (this.isSyncing) return; // Prevent multiple syncs at once
    this.isSyncing = true;
    
    try {
      const accounts = await UniboxService.fetchEmailAccounts();
      if (!accounts.length) return;

      const activeId = this.activeFilters.email_account_id;
      if (activeId) {
        await this.silentGmailSync(activeId, limit);
      } else {
        // Sync all accounts sequentially
        for (const account of accounts) {
          await this.silentGmailSync(account.id, limit);
        }
      }
    } catch (e) {
      console.warn("[BG_SYNC_LIST_FAIL]", e);
    } finally {
      this.isSyncing = false;
    }
  }

  async silentGmailSync(accountId, limit = 10) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return; // Don't poll if not logged in

      await supabase.functions.invoke('fetch-gmail-emails', {
        body: { accountId, limit }
      });
      // We don't need to manually refresh here, the Realtime listener above will catch the DB change
    } catch (e) {
      // Background sync failures are silent in the UI but logged
      console.warn("[SILENT_SYNC_FAIL]", e);
    }
  }

  async refreshAll() {
    const [messages, campaigns, accounts] = await Promise.all([
      UniboxService.fetchMessages(this.activeFilters),
      UniboxService.fetchCampaigns(),
      UniboxService.fetchEmailAccounts()
    ]);

    this.renderThreadList(messages);
    this.renderCampaigns(campaigns);
    this.renderAccounts(accounts);
    this.updateSearchVisibility();
    this.updateMiddlePaneTabsVisibility();
  }

  updateMiddlePaneTabsVisibility() {
    // Show 'Inbox'/'Sent' tabs only if an account is selected
    // Otherwise show 'Primary'/'Others' (simulated by using data-folder="inbox" as default)
    if (!this.elements.middlePaneTabs) return;
    
    const isAccountSelected = !!this.activeFilters.email_account_id;
    // We could potentially change the labels if needed, but 'Inbox'/'Sent' are fine for all views.
    // For now, let's just make sure the refresh button is only visible if an account is selected.
    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.style.display = isAccountSelected ? 'flex' : 'none';
    }
  }

  renderThreadList(messages) {
    this.replies = messages;
    if (messages.length === 0) {
      this.elements.threadList.innerHTML = `
        <div style="padding: 3rem 2rem; text-align: center; color: var(--text-muted);">
          <div style="margin-bottom: 1rem; opacity: 0.3;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M22 13s-3-2-5-2-5 2-5 2V5c0-1.1.9-2 2-2s2 .9 2 2v7"/><path d="M14 7V3c0-1.1-.9-2-2-2s-2 .9-2 2v10"/><path d="M10 11V5c0-1.1-.9-2-2-2S6 3.9 6 5v10"/><path d="M6 14v-4c0-1.1-.9-2-2-2S2 8.9 2 10v9c0 2.2 1.8 4 4 4h10c2.2 0 4-1.8 4-4"/></svg>
          </div>
          <p style="font-size: 0.9rem; font-weight: 500;">No messages found</p>
          <p style="font-size: 0.8rem; margin-top: 0.5rem;">Try adjusting your filters or search term.</p>
        </div>
      `;
      return;
    }

    this.elements.threadList.innerHTML = messages.map(msg => `
      <div class="thread-item ${msg.is_read ? '' : 'unread'} ${this.selectedReply?.id === msg.id ? 'active' : ''}" data-id="${msg.id}">
        <div class="thread-header">
          <span class="thread-sender">
            ${this.escapeHtml(msg.from_name || msg.from_email)}
            ${!msg.is_read ? '<span class="new-badge">New</span>' : ''}
          </span>
          <span class="thread-time">${this.formatDate(msg.received_at)}</span>
        </div>
        <div class="thread-subject">${this.escapeHtml(msg.subject || "(No Subject)")}</div>
        <div class="thread-snippet">${this.escapeHtml(msg.snippet || msg.body_text?.substring(0, 80) || "")}</div>
      </div>
    `).join("");
  }

  renderCampaigns(campaigns) {
    if (!this.elements.campaignFilters) return;
    this.elements.campaignFilters.innerHTML = campaigns.map(c => `
      <button class="filter-item ${this.activeFilters.campaign_id === c.id ? 'active' : ''}" data-campaign-id="${c.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary); opacity: 0.7;"><circle cx="12" cy="12" r="3"/></svg>
        <span>${this.escapeHtml(c.name)}</span>
      </button>
    `).join("");
  }

  renderAccounts(accounts) {
    if (!this.elements.accountFilters) return;
    this.elements.accountFilters.innerHTML = accounts.map(a => `
      <button class="filter-item ${this.activeFilters.email_account_id === a.id ? 'active' : ''}" data-account-id="${a.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>${this.escapeHtml(a.email_address)}</span>
      </button>
    `).join("");
  }

  updateSearchVisibility() {
    // Show global search only when 'All Inboxes' (no specific account/campaign) is selected
    // and the folder is 'inbox' (All Inboxes)
    const isAllInboxesView = !this.activeFilters.email_account_id && !this.activeFilters.campaign_id;
    const isInboxFolder = this.activeFilters.folder === 'inbox' && this.activeFilters.status === 'all';
    
    if (this.elements.globalSearchContainer) {
      if (isAllInboxesView && isInboxFolder) {
        this.elements.globalSearchContainer.classList.remove("hidden");
      } else {
        this.elements.globalSearchContainer.classList.add("hidden");
      }
    }
  }
  async renderConversation(msg) {
    this.selectedReply = msg;
    
    // Fetch full thread history (Inbox + Sent)
    let history = [];
    try {
      history = await UniboxService.fetchThreadHistory(msg.thread_id, msg.lead_id);
    } catch (e) {
      console.error("[UniboxUI] History fetch failed", e);
    }

    // Fallback: If history is empty, at least show the selected message
    if (history.length === 0) {
      history = [{ ...msg, type: 'received', timestamp: msg.received_at }];
    }

    const leadName = msg.lead ? `${msg.lead.first_name || ""} ${msg.lead.last_name || ""}`.trim() : (msg.from_name || msg.from_email);

    this.elements.contentView.innerHTML = `
      <header class="conversation-header">
        <div class="lead-info">
          <h2>${this.escapeHtml(leadName)}</h2>
          <div class="lead-meta">
            <span style="color: var(--primary); font-weight: 700;">${this.escapeHtml(msg.from_email)}</span>
            <span>•</span>
            <span>Campaign: <strong>${this.escapeHtml(msg.campaign?.name || "Direct")}</strong></span>
          </div>
        </div>
        <div class="lead-actions" style="display: flex; align-items: center; gap: 10px;">
          <select class="status-dropdown" id="lead-status-select" data-lead-id="${msg.lead_id}">
            <option value="Replied" ${msg.lead?.status === 'Replied' ? 'selected' : ''}>Replied</option>
            <option value="Interested" ${msg.lead?.status === 'Interested' ? 'selected' : ''}>Interested</option>
            <option value="Meeting Booked" ${msg.lead?.status === 'Meeting Booked' ? 'selected' : ''}>Meeting Booked</option>
            <option value="Won" ${msg.lead?.status === 'Won' ? 'selected' : ''}>Won</option>
            <option value="Not Interested" ${msg.lead?.status === 'Not Interested' ? 'selected' : ''}>Not Interested</option>
            <option value="Lost" ${msg.lead?.status === 'Lost' ? 'selected' : ''}>Lost</option>
          </select>
          <div class="dropdown" id="thread-more-dropdown">
            <button class="btn-icon-small" id="thread-more-btn">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
            <div class="dropdown-menu">
               <div class="dropdown-item" data-action="archive">Archive</div>
               <div class="dropdown-item" data-action="block">Block</div>
            </div>
          </div>
        </div>
      </header>
      
      <div class="messages-container scrollable">
        ${history.map(item => `
          <div class="message-bubble ${item.type === 'received' ? 'message-received' : 'message-sent'}">
            <div class="message-meta">
              <span style="font-weight: 700;">${this.escapeHtml(item.from_name || item.from_email)}</span>
              <span>${this.formatDateTime(item.timestamp)}</span>
            </div>
            <div class="message-body">
              ${item.body_html || item.body_text?.replace(/\n/g, '<br>') || "No content"}
            </div>
          </div>
        `).join("")}
      </div>

      <div class="reply-editor">
        <div class="editor-box" id="reply-container">
          <textarea id="reply-text" placeholder="Write a reply..."></textarea>
          <div class="editor-actions">
            <button class="btn-primary-small" id="btn-send-reply">
               <span>Send Reply</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Add expansion listener
    const replyContainer = document.getElementById("reply-container");
    const replyText = document.getElementById("reply-text");
    replyText?.addEventListener("focus", () => replyContainer?.classList.add("expanded"));
    
    // Mark as read if it's a received message
    if (msg.id && !msg.is_read) {
        await UniboxService.markAsRead(msg.id);
        msg.is_read = true;
        this.renderThreadList(this.replies); 
    }
  }

  formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  formatDateTime(dateStr) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleString([], { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
  }

  escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

/**
 * Controller & Event Listeners
 */
async function initUnibox() {
  const ui = new UniboxUI();
  
  try {
    const session = await requireAuth();
    if (!session) return;
    
    const user = await getCurrentUser();
    await ui.init(user);

    setupEventListeners(ui);

    // Sidebar Logout
    document.getElementById("logout-btn")?.addEventListener("click", signOut);

  } catch (err) {
    console.error("Unibox Init Error:", err);
  }
}

function setupEventListeners(ui) {
  // Toggle More Labels dropdown
  const moreBtn = document.getElementById("more-btn");
  const moreContainer = document.getElementById("status-more-container");
  if (moreBtn && moreContainer) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moreContainer.classList.toggle("active");
    });
  }

  // Close dropdown on outside click
  document.addEventListener("click", () => {
    moreContainer?.classList.remove("active");
  });

  // 1. Status Filters (Lead Status) - Top Level
  document.querySelectorAll("#status-filters .filter-item[data-status]").forEach(btn => {
    btn.addEventListener("click", async () => {
      clearAllActive(ui);
      btn.classList.add("active");
      
      ui.activeFilters.status = btn.dataset.status;
      ui.activeFilters.folder = "inbox";
      ui.activeFilters.campaign_id = null;
      ui.activeFilters.email_account_id = null;
      
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
    });
  });

  // 1b. Status Filters (Dropdown items)
  document.querySelectorAll("#more-dropdown-menu .dropdown-item[data-status]").forEach(item => {
    item.addEventListener("click", async () => {
      clearAllActive(ui);
      // Highlight the 'More' button when a dropdown item is active
      document.getElementById("more-btn")?.classList.add("active");
      
      ui.activeFilters.status = item.dataset.status;
      ui.activeFilters.folder = "inbox";
      ui.activeFilters.campaign_id = null;
      ui.activeFilters.email_account_id = null;
      
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
    });
  });

  // 2. Folder Filters (Inbox, Unread, Sent)
  document.querySelectorAll("#inbox-filters .filter-item").forEach(btn => {
    btn.addEventListener("click", async () => {
      clearAllActive(ui);
      btn.classList.add("active");
      
      ui.activeFilters.folder = btn.dataset.folder;
      ui.activeFilters.status = "all";
      ui.activeFilters.campaign_id = null;
      ui.activeFilters.email_account_id = null;
      
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
    });
  });

  // 3. Global Search (X-Account)
  ui.elements.globalSearch?.addEventListener("input", debounce(async (e) => {
    ui.activeFilters.search = e.target.value;
    const filtered = await UniboxService.fetchMessages(ui.activeFilters);
    ui.renderThreadList(filtered);
  }, 300));

  // 4. Thread-specific Search
  ui.elements.searchInput?.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = ui.replies.filter(r => 
      (r.from_email?.toLowerCase().includes(term)) ||
      (r.from_name?.toLowerCase().includes(term)) ||
      (r.subject?.toLowerCase().includes(term)) ||
      (r.snippet?.toLowerCase().includes(term))
    );
    ui.renderThreadList(filtered);
  });

  // 5. Click Delegation for Dynamic Elements
  document.body.addEventListener("click", async (e) => {
    // Campaign Filter Click
    const campBtn = e.target.closest(".filter-item[data-campaign-id]");
    if (campBtn) {
      clearAllActive(ui);
      campBtn.classList.add("active");
      ui.activeFilters.campaign_id = campBtn.dataset.campaign_id;
      ui.activeFilters.email_account_id = null;
      ui.activeFilters.status = "all";
      ui.activeFilters.folder = "inbox";
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
    }

    // Account Filter Click
    const accBtn = e.target.closest(".filter-item[data-account-id]");
    if (accBtn) {
      clearAllActive(ui);
      accBtn.classList.add("active");
      ui.activeFilters.email_account_id = accBtn.dataset.accountId;
      ui.activeFilters.campaign_id = null;
      ui.activeFilters.status = "all";
      ui.activeFilters.folder = "inbox"; // Default to Inbox when switching account
      
      // Update Middle Pane Tabs UI
      ui.elements.middlePaneTabs?.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.folder === "inbox");
      });

      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
      ui.updateMiddlePaneTabsVisibility();
    }

    // Middle Pane Tab Click (Inbox/Sent toggle)
    const tabBtn = e.target.closest(".tab-btn[data-folder]");
    if (tabBtn) {
      ui.elements.middlePaneTabs.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      tabBtn.classList.add("active");
      
      ui.activeFilters.folder = tabBtn.dataset.folder;
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
    }

    // Sync Selected Account Button Click
    const refreshBtn = e.target.closest("#refresh-account-btn");
    if (refreshBtn) {
      if (!ui.activeFilters.email_account_id) {
        ui.showToast("Please select a specific email account to sync, or use 'Sync All'.", "warning");
        return;
      }
      
      console.log(`[FRONTEND_SYNC] Starting sync for account: ${ui.activeFilters.email_account_id}`);
      refreshBtn.classList.add("spinning");
      ui.showToast("Fetching real emails from Gmail...", "info");
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No active session. Please log in again.");

        const { data, error } = await supabase.functions.invoke('fetch-gmail-emails', {
          body: { accountId: ui.activeFilters.email_account_id }
        });

        if (error) {
            console.error("[FRONTEND_SYNC_ERROR] Edge Function returned error:", error);
            // Try to extract msg from body if available
            throw error;
        }

        console.log("[FRONTEND_SYNC_SUCCESS] Sync completed successfully:", data);

        // Re-fetch local data to update UI once the edge function finishes syncing
        const filtered = await UniboxService.fetchMessages(ui.activeFilters);
        ui.renderThreadList(filtered);
        ui.showToast("Success! Real emails synced from Gmail.", "success");
      } catch (err) {
        console.error("[FRONTEND_SYNC_CRITICAL] Sync failed:", err);
        let errorMsg = err.message;
        
        // Handle common Supabase/Gateway errors
        if (err.message?.includes("Failed to send a request") || err.message?.includes("network error") || err.message?.includes("502")) {
          errorMsg = "Sync timed out or connection lost. Please try again in 30 seconds.";
        } else if (err.context && err.context.json) {
           errorMsg = err.context.json.error || errorMsg;
        }

        ui.showToast(`Sync failed: ${errorMsg}`, "error");
      } finally {
        refreshBtn.classList.remove("spinning");
      }
    }

    // Sync All Button Click
    const syncAllBtn = e.target.closest("#sync-all-btn");
    if (syncAllBtn) {
      console.log("[FRONTEND_SYNC_ALL] Starting global sync...");
      syncAllBtn.classList.add("spinning");
      ui.showToast("Syncing all accounts... this may take a moment", "info");
      
      try {
        const accounts = await UniboxService.fetchEmailAccounts();
        if (!accounts.length) {
            ui.showToast("No connected accounts found.", "warning");
            return;
        }

        let successCount = 0;
        let failCount = 0;

        for (const account of accounts) {
            console.log(`[FRONTEND_SYNC_ALL] Syncing ${account.email_address}...`);
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) continue;
                
                await supabase.functions.invoke('fetch-gmail-emails', {
                    body: { accountId: account.id }
                });
                successCount++;
            } catch (err) {
                console.error(`[FRONTEND_SYNC_ALL] Failed for ${account.email_address}:`, err);
                failCount++;
            }
        }

        // Re-fetch local data
        const filtered = await UniboxService.fetchMessages(ui.activeFilters);
        ui.renderThreadList(filtered);
        
        if (failCount === 0) {
            ui.showToast(`Success! Synced ${successCount} accounts.`, "success");
        } else {
            ui.showToast(`Synced ${successCount} accounts. ${failCount} failed (check App Passwords).`, "warning");
        }
      } catch (err) {
        console.error("[FRONTEND_SYNC_ALL_CRITICAL] Global sync failed:", err);
        ui.showToast("Global sync failed. Check console for details.", "error");
      } finally {
        syncAllBtn.classList.remove("spinning");
      }
    }

    // Thread Item Click
    const threadItem = e.target.closest(".thread-item");
    if (threadItem) {
      const msgId = threadItem.dataset.id;
      const msg = ui.replies.find(r => r.id === msgId);
      if (msg) {
        document.querySelectorAll(".thread-item").forEach(item => item.classList.remove("active"));
        threadItem.classList.add("active");
        ui.renderConversation(msg);
      }
    }

    // Send Reply Button Click
    const sendReplyBtn = e.target.closest("#btn-send-reply");
    if (sendReplyBtn) {
      const replyTextArea = document.getElementById("reply-text");
      const body = replyTextArea?.value.trim();
      const msg = ui.selectedReply;

      if (!body) {
        ui.showToast("Please enter a reply message.", "warning");
        return;
      }
      if (!msg) {
        ui.showToast("No active thread to reply to.", "error");
        return;
      }

      console.log("[FRONTEND_SEND] Sending reply...");
      sendReplyBtn.disabled = true;
      sendReplyBtn.innerHTML = "<span>Sending...</span>";

      try {
        const { data, error } = await supabase.functions.invoke('send-email', {
          body: {
            accountId: msg.email_account_id,
            to: (msg.type === 'sent') ? msg.to_email : msg.from_email,
            subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
            body,
            threadId: msg.thread_id
          }
        });

        if (error) throw error;

        ui.showToast("Reply sent successfully!", "success");
        replyTextArea.value = "";
        document.getElementById("reply-container")?.classList.remove("expanded");
        
        // Wait a tiny bit for DB to index, then refresh the conversation history
        setTimeout(async () => {
          await ui.renderConversation(msg); 
        }, 800);
      } catch (err) {
        console.error("[FRONTEND_SEND_CRITICAL]", err);
        ui.showToast(`Failed to send: ${err.message}`, "error");
      } finally {
        sendReplyBtn.disabled = false;
        sendReplyBtn.innerHTML = "<span>Send Reply</span>";
      }
    }

    // Close dropdowns on outside click (Dropdown toggle is handled specifically above)
    if (!e.target.closest(".dropdown")) {
       document.querySelectorAll(".dropdown").forEach(d => d.classList.remove("active"));
    }
  });

  // 6. Lead Status Update
  document.body.addEventListener("change", async (e) => {
    if (e.target.id === "lead-status-select") {
      const leadId = e.target.dataset.leadId;
      const status = e.target.value;
      try {
        const isStopping = await UniboxService.updateLeadStatus(leadId, status);
        ui.showToast(`Status updated: ${status}${isStopping ? ' (Campaign Stopped)' : ''}`, "success");
        // Re-fetch to update list if filtered by status
        const filtered = await UniboxService.fetchMessages(ui.activeFilters);
        ui.renderThreadList(filtered);
      } catch (err) {
        ui.showToast("Failed to update status", "error");
      }
    }
  });
}

function clearAllActive(ui) {
  document.querySelectorAll(".unibox-filters .filter-item").forEach(b => b.classList.remove("active"));
}

function debounce(fn, ms) {
  let timeoutId;
  return function(...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
}

initUnibox();
