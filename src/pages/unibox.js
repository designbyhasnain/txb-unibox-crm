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
        body_text: s.body_text || s.subject // Fixed: Use actual body text instead of subject
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

  static async searchLeads(query) {
      if (!query || query.length < 2) return [];
      const { data, error } = await supabase
          .from("leads")
          .select("id, email, first_name, last_name")
          .or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
          .limit(10);
      
      if (error) {
          console.error("Lead search error:", error);
          return [];
      }
      return data || [];
  }

  static async sendEmail({ accountId, to, subject, body, leadId, threadId = null, inReplyTo = null }) {
    // 1. Prepare Payload
    const payload = {
        accountId,
        to,
        subject,
        htmlBody: body,
        leadId,
        threadId, // Optional: if replying to existing thread
        originalMessageId: inReplyTo // Optional: for In-Reply-To header
    };

    console.log("Sending email with payload:", payload);

    try {
        // 2. Invoke Edge Function
        const { data: funcData, error: funcError } = await supabase.functions.invoke('send-email', {
            body: payload
        });

        if (funcError) {
             console.error("Edge function error:", funcError);
             throw new Error("Failed to send email via provider.");
        }

        console.log("Email sent successfully via Edge Function:", funcData);

        // 3. Log to DB (if Edge function doesn't do it, or for optimistic UI)
        // Note: The edge function in your codebase seems to already insert into 'email_logs'.
        // We can double Check if we need to insert here or just return.
        // If the edge function inserts, we might get duplicate logs if we insert here too.
        // Let's assume for now we rely on the Edge Function's insertion or return the data.
        
        return funcData;

    } catch (e) {
        console.warn("Edge function invoke failed, attempting fallback DB log for UI:", e);
        
        // Fallback: Insert into email_logs so user sees "Sent" even if backend failed (for retry later?)
        // Or just re-throw to let user know it failed.
        // For a robust system, we should probably throw so the user knows it didn't go through.
        throw e;
    }
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
      refreshBtn: document.getElementById("refresh-account-btn"),
      
      // Compose Elements
      composeBtnMain: document.getElementById("btn-compose-main"),
      composeModal: document.getElementById("compose-modal"),
      btnCloseCompose: document.getElementById("btn-close-compose"),
      btnMinimizeCompose: document.getElementById("btn-minimize-compose"),
      composeFrom: document.getElementById("compose-from-select"),
      composeTo: document.getElementById("compose-to"),
      composeSuggestions: document.getElementById("compose-suggestions"),
      composeSubject: document.getElementById("compose-subject"),
      composeEditor: document.getElementById("compose-editor"),
      composeSendBtn: document.getElementById("btn-send-compose"),
      composeFmtToggle: document.getElementById("compose-fmt-toggle"),
      composeLink: document.getElementById("compose-link")
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
    this.isSyncing = false; 
    this.bgSyncInterval = null;
    this.realtimeChannel = null;
    
    this.initCompose();
  }
  
  initCompose() {
    // 1. Open Modal
    this.elements.composeBtnMain?.addEventListener("click", async () => {
        this.elements.composeModal.classList.remove("minimized");
        this.elements.composeModal.classList.add("active");
        this.elements.composeTo.focus();
        
        // Populate 'From' accounts if empty
        if (this.elements.composeFrom.options.length === 0) {
            const accounts = await UniboxService.fetchEmailAccounts();
            this.elements.composeFrom.innerHTML = accounts.map(acc => 
                `<option value="${acc.id}">${acc.email_address}</option>`
            ).join("");
        }
    });

    // 2. Close/Minimize
    this.elements.btnCloseCompose?.addEventListener("click", () => {
        this.elements.composeModal.classList.remove("active");
        // Clear fields? Optionally
    });
    
    this.elements.btnMinimizeCompose?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.elements.composeModal.classList.toggle("minimized");
    });
    
    // Restore from minimized
    this.elements.composeModal?.addEventListener("click", (e) => {
        if (this.elements.composeModal.classList.contains("minimized")) {
            this.elements.composeModal.classList.remove("minimized");
        }
    });
    
    // Prevent modal close when clicking inside body
    const body = this.elements.composeModal?.querySelector(".compose-body");
    body?.addEventListener("click", (e) => e.stopPropagation());

    // 3. Autocomplete Logic
    let debounceTimer;
    this.elements.composeTo?.addEventListener("input", (e) => {
        const query = e.target.value;
        clearTimeout(debounceTimer);
        
        debounceTimer = setTimeout(async () => {
            if (query.length < 2) {
                this.elements.composeSuggestions.classList.add("hidden");
                return;
            }
            
            const leads = await UniboxService.searchLeads(query);
            if (leads.length > 0) {
                this.elements.composeSuggestions.innerHTML = leads.map(lead => `
                    <div class="suggestion-item" data-email="${lead.email}" data-id="${lead.id}">
                        <div class="suggestion-name">${lead.first_name || ''} ${lead.last_name || ''}</div>
                        <div class="suggestion-email">${lead.email}</div>
                    </div>
                `).join("");
                this.elements.composeSuggestions.classList.remove("hidden");
                
                // Click Handler
                this.elements.composeSuggestions.querySelectorAll(".suggestion-item").forEach(item => {
                    item.addEventListener("click", (ev) => {
                       ev.stopPropagation();
                       this.elements.composeTo.value = item.dataset.email;
                       this.elements.composeTo.dataset.leadId = item.dataset.id; // Store ID
                       this.elements.composeSuggestions.classList.add("hidden");
                    });
                });
            } else {
                this.elements.composeSuggestions.classList.add("hidden");
            }
        }, 300);
    });
    
    // Hide suggestions on outside click
    document.addEventListener("click", (e) => {
        if (!this.elements.composeTo?.contains(e.target)) {
            this.elements.composeSuggestions?.classList.add("hidden");
        }
    });

    // 4. Send Logic
    this.elements.composeSendBtn?.addEventListener("click", async () => {
        const to = this.elements.composeTo.value;
        const subject = this.elements.composeSubject.value;
        const body = this.elements.composeEditor.innerHTML;
        const accountId = this.elements.composeFrom.value;
        const leadId = this.elements.composeTo.dataset.leadId || null;
        
        if (!to || !subject) {
            this.showToast("Please fill recipients and subject", "error");
            return;
        }
        
        this.elements.composeSendBtn.textContent = "Sending...";
        this.elements.composeSendBtn.disabled = true;
        
        try {
            await UniboxService.sendEmail({ accountId, to, subject, body, leadId });
            this.showToast("Message sent successfully", "success");
            this.elements.composeModal.classList.remove("active");
            // Clear
            this.elements.composeTo.value = "";
            this.elements.composeSubject.value = "";
            this.elements.composeEditor.innerHTML = "";
            
            // Refresh list to show Sent item
            await this.refreshAll();
        } catch (err) {
            console.error("Send failed", err);
            this.showToast("Failed to send message", "error");
        } finally {
            this.elements.composeSendBtn.textContent = "Send";
            this.elements.composeSendBtn.disabled = false;
        }
    });
    
    // 5. Basic Formatting Setup (Reuse)
    this.elements.composeFmtToggle?.addEventListener("click", () => {
       document.execCommand('bold', false, null); // Simple toggle for now, or expand toolbar
       this.elements.composeEditor.focus();
    });
    
    this.elements.composeLink?.addEventListener("click", () => {
        const url = prompt("Enter URL:", "https://");
        if (url) {
            document.execCommand('createLink', false, url);
        }
    });
    
    // 6. Attachment Logic
    const attachBtn = document.getElementById("compose-attach-btn");
    const fileInput = document.getElementById("compose-file-input");
    
    attachBtn?.addEventListener("click", () => fileInput?.click());
    
    fileInput?.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files).map(f => f.name).join(", ");
            this.showToast(`Selected files: ${files}`, "info");
            // Visual feedback in editor
            this.elements.composeEditor.focus();
            document.execCommand('insertHTML', false, `<br><i>[Attachment: ${files}]</i><br>`);
        }
    });
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
    // 0. Clean up existing listeners/channels to prevent memory leaks
    if (this.bgSyncInterval) clearInterval(this.bgSyncInterval);
    if (this.realtimeChannel) this.realtimeChannel.unsubscribe();
    
    // 1. Listen for new replies or logs in the database
    this.realtimeChannel = supabase
      .channel('unibox-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, () => {
        this.refreshAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_logs' }, () => {
        this.refreshAll();
      })
      .subscribe();

    // Initial background sync run (Deep Sync)
    setTimeout(() => this.runBackgroundSyncList(50), 2000);

    // 2. Background Polling (Quick Sync every 30s - slower but safer to avoid 502/CORS)
    this.bgSyncInterval = setInterval(() => {
      this.runBackgroundSyncList(10);
    }, 30000); 

    // 3. Sync on Focus - Single global listener check
    if (!window._uniboxHasFocusListener) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          console.log("[UniboxUI] Tab focused: Triggering quick sync...");
          this.runBackgroundSyncList(5); // Only 5 for speed
        }
      });
      window._uniboxHasFocusListener = true;
    }
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
        <div class="gmail-editor" id="reply-container">
          <!-- Reference-Perfect Header -->
          <div class="gmail-editor-header">
             <div class="header-recipient">
                <svg class="header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 5 5v3"/></svg>
                <svg class="header-icon-small" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                <span class="recipient-info">${this.escapeHtml(msg.from_name || '')} (${this.escapeHtml(msg.from_email || '')})</span>
             </div>
             <div class="gmail-header-right">
                <span class="draft-pill" id="draft-saved-pill">Draft Saved</span>
                <svg class="header-icon clickable" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
             </div>
          </div>

          <div class="gmail-editor-body">
            <div id="reply-text" contenteditable="true" data-placeholder="Write a reply..." class="gmail-rich-editor" style="font-family: 'Tahoma', sans-serif;"></div>
          </div>

          <!-- Pixel-Perfect Pill Floating Toolbar -->
          <div class="gmail-formatting-bar pill-toolbar" id="gmail-fmt-bar">
             <div class="fmt-group">
                <div class="fmt-btn" id="fmt-undo" title="Undo">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V3h4"/><path d="M3 3c5.5 0 10 4.5 10 10s-4.5 10-10 10"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-redo" title="Redo">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7V3h-4"/><path d="M21 3c-5.5 0-10 4.5-10 10s4.5 10 10 10"/></svg>
                </div>
             </div>
             <div class="fmt-group">
                <select class="fmt-select" id="fmt-font" title="Font">
                   <option value="Tahoma" selected>Tahoma</option>
                   <option value="Sans Serif">Sans Serif</option>
                   <option value="Georgia">Georgia</option>
                </select>
                <div class="fmt-btn" title="Text size" id="fmt-size">
                   <span>TT</span>
                   <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                </div>
             </div>
             <div class="fmt-group">
                <div class="fmt-btn bold" id="fmt-bold" title="Bold">B</div>
                <div class="fmt-btn italic" id="fmt-italic" title="Italic">I</div>
                <div class="fmt-btn underline" id="fmt-underline" title="Underline">U</div>
                <div class="fmt-btn" id="fmt-color" title="Text color">
                   <span style="border-bottom: 2px solid #ea4335">A</span>
                   <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                </div>
             </div>
             <div class="fmt-group">
                <div class="fmt-btn" id="fmt-align" title="Align">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                   <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-list-num" title="Numbered list">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-list-bullet" title="Bulleted list">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-indent-less" title="Less indent">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><line x1="18" y1="12" x2="6" y2="12"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-indent-more" title="More indent">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-quote" title="Quote">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5H3v8h4c0 2-2 4-4 4"/><path d="M14 21c3 0 7-1 7-8V5h-7v8h4c0 2-2 4-4 4"/></svg>
                </div>
             </div>
             <div class="fmt-group">
                <div class="fmt-btn" id="fmt-strikethrough" title="Strikethrough">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
                </div>
                <div class="fmt-btn" id="fmt-clear" title="Remove formatting">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/><line x1="15" y1="15" x2="9" y2="21"/></svg>
                </div>
             </div>
          </div>

          <div class="gmail-editor-footer">
            <div class="gmail-toolbar-left">
               <div class="gmail-send-group">
                  <button class="gmail-btn-send" id="btn-send-reply">Send</button>
                  <div class="send-separator"></div>
                  <button class="gmail-btn-send-dropdown">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
               </div>
               <div class="gmail-toolbar-icons">
                  <div class="toolbar-icon" id="btn-toggle-fmt" title="Formatting options">
                    <span style="font-size: 16px; font-family: 'Tahoma', sans-serif; font-weight: 500; color: #5f6368;">Aa</span>
                  </div>
                  <div class="toolbar-icon" id="btn-attach" title="Attach files">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  </div>
                  <div class="toolbar-icon" id="btn-insert-link" title="Insert link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </div>
                  <div class="toolbar-icon" id="btn-emoji" title="Insert emoji">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>
                  </div>
                  <div class="toolbar-icon" title="Insert files using Drive">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22h6.5a2.5 2.5 0 0 0 0-5H12"/><path d="M12 22H5.5a2.5 2.5 0 0 1 0-5H12"/><path d="M12 17V2"/><path d="m5 9 7-7 7 7"/></svg>
                  </div>
                  <div class="toolbar-icon" title="Insert photo">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  </div>
                  <div class="toolbar-icon" title="Toggle confidential mode">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  </div>
                  <div class="toolbar-icon" id="btn-signature" title="Insert signature">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </div>
               </div>
            </div>
            <div class="gmail-toolbar-right">
               <div class="toolbar-icon" id="btn-discard" title="Discard draft">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
               </div>
            </div>
          </div>
          <!-- Hidden File Input for Attachments -->
          <input type="file" id="reply-file-input" multiple style="display: none;">
        </div>
      </div>
    `;

    // Add expansion listener
    const replyContainer = document.getElementById("reply-container");
    const replyText = document.getElementById("reply-text");
    
    // --- Universal Logic Portfolio ---
    const threadKey = `draft_${msg.thread_id}`;
    const draftContent = localStorage.getItem(threadKey);
    const draftPill = document.getElementById("draft-saved-pill");

    // 1. Initial State Restoration
    if (draftContent && replyText) {
        replyText.innerHTML = draftContent;
        draftPill?.classList.add("visible");
        replyContainer?.classList.add("expanded");
    }

    // 2. Draft Persistence (Auto-save for Rich Text)
    replyText?.addEventListener("input", (e) => {
        const val = e.target.innerHTML;
        if (val.trim() && val !== '<br>') {
            localStorage.setItem(threadKey, val);
            draftPill?.classList.add("visible");
        } else {
            localStorage.removeItem(threadKey);
            draftPill?.classList.remove("visible");
        }
    });

    // --- Dropdown Logic (Status & Thread Actions) ---
    const statusSelect = document.getElementById("lead-status-select");
    statusSelect?.addEventListener("change", async (e) => {
        const newStatus = e.target.value;
        // Visual feedback immediately
        this.showToast(`Updating status to ${newStatus}...`, "info");
        try {
            await UniboxService.updateLeadStatus(msg.lead_id, newStatus);
            this.showToast("Lead status updated successfully", "success");
        } catch (err) {
            console.error("Status update failed:", err);
            this.showToast("Failed to update status", "error");
            // Revert selection if possible or just log error
        }
    });

    const moreBtn = document.getElementById("thread-more-btn");
    const moreDropdown = document.getElementById("thread-more-dropdown");
    
    // Toggle Menu
    moreBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        moreDropdown?.classList.toggle("active");
    });
    
    // Handle Menu Actions
    moreDropdown?.querySelectorAll(".dropdown-item").forEach(item => {
        item.addEventListener("click", (e) => {
            const action = e.target.getAttribute("data-action");
            this.showToast(`${action} action triggered (Not implemented yet)`, "info");
            moreDropdown.classList.remove("active");
        });
    });

    // Close on Outside Click
    document.addEventListener("click", (e) => {
        if (!moreDropdown?.contains(e.target)) {
            moreDropdown?.classList.remove("active");
        }
    });

    // Toggle Formatting Bar (Reference Style)
    const fmtBtn = document.getElementById("btn-toggle-fmt");
    const fmtBar = document.getElementById("gmail-fmt-bar");
    const discardBtn = document.getElementById("btn-discard");
    const attachBtn = document.getElementById("btn-attach");
    const fileInput = document.getElementById("reply-file-input");
    const linkBtn = document.getElementById("btn-insert-link");
    const emojiBtn = document.getElementById("btn-emoji");
    const sendReplyBtn = document.getElementById("btn-send-reply");
    const signatureBtn = document.getElementById("btn-signature");

    fmtBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        fmtBar?.classList.toggle("active");
        replyContainer?.classList.add("expanded");
        replyText.focus();
    });

    // 4. Missing Features Placeholders & Implementation
    const driveBtn = document.getElementById("btn-drive");
    const photoBtn = document.getElementById("btn-photo");
    const photoInput = document.getElementById("reply-photo-input");
    const confidentialBtn = document.getElementById("btn-confidential");

    driveBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showToast("Google Drive integration coming soon", "info");
    });

    confidentialBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showToast("Confidential mode not available in this version", "info");
    });

    // Valid Image Insert
    photoBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        photoInput?.click();
    });

    photoInput?.addEventListener("change", (e) => {
        if (photoInput.files && photoInput.files[0]) {
            const file = photoInput.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
               replyText.focus();
               const imgHtml = `<img src="${ev.target.result}" style="max-width: 100%; border-radius: 4px; margin: 10px 0;" alt="Image">`;
               document.execCommand('insertHTML', false, imgHtml);
               replyContainer?.classList.add("expanded");
            };
            reader.readAsDataURL(file);
        }
    });

    // 5. Signature Injection (Enhanced)
    signatureBtn?.addEventListener("mousedown", (e) => e.preventDefault());
    signatureBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const signature = `<br><br>--<br>${localStorage.getItem("user_name") || "Best Regards"}<br>Lead Outreach Specialist | TXB CRM`;
        if (replyText) {
            replyText.innerHTML += signature;
            // Trigger input event to save draft
            replyText.dispatchEvent(new Event('input'));
            replyText.focus();
        }
    });

     // --- Professional Formatting Logic ---
     const formatCommands = {
        'fmt-undo': 'undo',
        'fmt-redo': 'redo',
        'fmt-bold': 'bold',
        'fmt-italic': 'italic',
        'fmt-underline': 'underline',
        'fmt-list-num': 'insertOrderedList',
        'fmt-list-bullet': 'insertUnorderedList',
        'fmt-indent-less': 'outdent',
        'fmt-indent-more': 'indent',
        'fmt-quote': 'formatBlock', // Specialized below
        'fmt-strikethrough': 'strikeThrough',
        'fmt-clear': 'removeFormat'
     };

     // Alignment Handler
     const alignBtn = document.getElementById('fmt-align');
     let alignState = 0; // 0: left, 1: center, 2: right
     alignBtn?.addEventListener("mousedown", (e) => e.preventDefault());
     alignBtn?.addEventListener("click", (e) => {
         e.stopPropagation();
         alignState = (alignState + 1) % 3;
         const cmd = alignState === 0 ? 'justifyLeft' : (alignState === 1 ? 'justifyCenter' : 'justifyRight');
         document.execCommand(cmd, false, null);
         replyText.focus();
     });

     Object.keys(formatCommands).forEach(id => {
        const btn = document.getElementById(id);
        btn?.addEventListener("mousedown", (e) => e.preventDefault());
        btn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const cmd = formatCommands[id];
            if (cmd === 'formatBlock') {
                document.execCommand(cmd, false, 'blockquote');
            } else {
                document.execCommand(cmd, false, null);
            }
            replyText.focus();
        });
     });

      const colorBtn = document.getElementById('fmt-color');
      const colorInput = document.getElementById("reply-color-input");
      
      colorBtn?.addEventListener("mousedown", (e) => e.preventDefault());
      colorBtn?.addEventListener("click", (e) => {
         e.stopPropagation();
         colorInput.click();
      });
      
      colorInput?.addEventListener("input", (e) => {
         document.execCommand('foreColor', false, e.target.value);
         replyText.focus();
      });

      // --- Robust Selection Persistence ---
      let lastKnownRange = null;

      const saveSelection = () => {
          const sel = window.getSelection();
          if (sel.rangeCount > 0 && replyText.contains(sel.anchorNode)) {
              lastKnownRange = sel.getRangeAt(0);
          }
      };

      const restoreSelection = () => {
          if (lastKnownRange) {
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(lastKnownRange);
          } else {
              replyText.focus(); // Fallback
          }
      };

      // Track selection state
      replyText?.addEventListener("keyup", saveSelection);
      replyText?.addEventListener("mouseup", saveSelection);
      replyText?.addEventListener("input", saveSelection);
      replyText?.addEventListener("focus", saveSelection);

      // Font Selection
      const fontSelect = document.getElementById('fmt-font');
      
      fontSelect?.addEventListener("click", saveSelection); // Ensure we catch it before focus shifts
      fontSelect?.addEventListener("change", (e) => {
         restoreSelection();
         document.execCommand('fontName', false, e.target.value);
         saveSelection(); // Update for next action
         replyText.focus();
      });

      // Text Size (TT) Logic
      const sizeBtn = document.getElementById('fmt-size');
      let currentSize = 3; // Default
      sizeBtn?.addEventListener("mousedown", (e) => e.preventDefault());
      sizeBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          restoreSelection(); // Restore before applying
          
          if (currentSize === 3) currentSize = 5;
          else if (currentSize === 5) currentSize = 7;
          else if (currentSize === 7) currentSize = 2;
          else currentSize = 3;
          
          document.execCommand('fontSize', false, currentSize.toString());
          saveSelection();
          replyText.focus();
      });

    // --- Icon Logic Implementation (Robust & Focus-Safe) ---
    // Helper to keep focus on editor
    const tools = [fmtBtn, attachBtn, linkBtn, emojiBtn, signatureBtn, discardBtn];
    tools.forEach(tool => {
        tool?.addEventListener("mousedown", (e) => {
            e.preventDefault(); // Prevents focus loss from editor
        });
    });

    // 0.1 Send Logic (Gmail API Integration)
    sendReplyBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const content = (replyText?.innerHTML || "").trim();
        // Check for meaningful content (not just empty br tags)
        const cleanContent = replyText?.textContent?.trim();
        
        if (!cleanContent && !content.includes('<img')) {
            this.showToast("Please enter a message", "error");
            return;
        }

        const originalBtnText = sendReplyBtn.textContent;
        sendReplyBtn.textContent = "Sending...";
        sendReplyBtn.disabled = true;

        try {
            const { data, error } = await supabase.functions.invoke('send-email', {
                body: {
                    accountId: msg.email_account_id,
                    to: msg.from_email, // Dynamic routing from conversation context
                    subject: document.getElementById("reply-subject")?.value || `Re: ${msg.subject}`,
                    htmlBody: content,
                    threadId: msg.thread_id,
                    originalMessageId: msg.message_id
                }
            });

            if (error || (data && data.error)) {
                throw new Error(error?.message || data?.error || "Failed to send");
            }

            this.showToast("Email sent correctly!", "success");
            
            // Clear draft
            localStorage.removeItem(threadKey);
            replyText.innerHTML = "";
            replyContainer?.classList.remove("expanded");
            
            // Refresh conversation instantly
            await this.renderConversation(msg);

        } catch (err) {
            console.error("Send Error:", err);
            this.showToast(`Error: ${err.message}`, "error");
        } finally {
            sendReplyBtn.textContent = originalBtnText;
            sendReplyBtn.disabled = false;
        }
    });

    // 1. Attachment Logic
    attachBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput?.click();
    });

    // Handle File Selection
    fileInput?.addEventListener("change", (e) => {
        if (fileInput.files && fileInput.files[0]) {
            const fileName = fileInput.files[0].name;
             // Insert a placeholder for now
            replyText.focus();
            document.execCommand('insertHTML', false, `<div class="attachment-chip" style="display:inline-block; background:#f1f3f4; padding:2px 8px; border-radius:12px; margin:2px; font-size:12px; border:1px solid #ddd;">📎 ${this.escapeHtml(fileName)}</div>&nbsp;`);
        }
    });

    // 2. Link Insertion
    linkBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const url = prompt("Enter URL:", "https://");
        if (url) {
            replyText.focus();
            document.execCommand('createLink', false, url);
            replyContainer?.classList.add("expanded");
        }
    });

    // 3. Emoji Quick-insert
     emojiBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (replyText) {
            replyText.focus();
            document.execCommand("insertText", false, "😊");
        }
    });

    // 4. Keyboard shortcut: Ctrl+Enter to send
    replyText?.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            sendReplyBtn?.click();
        }
    });

    // Sync contenteditable
    replyText?.addEventListener("input", () => {
        localStorage.setItem(threadKey, replyText.innerHTML);
        draftPill?.classList.add("visible");
    });

     // Expand when clicking anywhere in the box
     replyContainer?.addEventListener("click", () => {
        replyContainer?.classList.add("expanded");
        replyText?.focus();
      });

    // Final Cleanup on discard
    discardBtn?.addEventListener("mousedown", (e) => e.preventDefault());
    discardBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if(!confirm("Are you sure you want to discard this draft?")) return;
        localStorage.removeItem(threadKey);
        if (replyText) replyText.innerHTML = "";
        replyContainer?.classList.remove("expanded");
        fmtBar?.classList.remove("active");
        draftPill?.classList.remove("visible");
        this.showToast("Draft discarded", "info");
    });
    
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
      sendReplyBtn.textContent = "Sending...";

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
        sendReplyBtn.textContent = "Send";
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
