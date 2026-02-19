/**
 * unibox.js — Thin orchestrator for the Unibox page.
 *
 * Architecture:
 *   uniboxService.js    — All Supabase queries + email sending
 *   uniboxUtils.js      — Pure helpers (formatDate, escapeHtml, debounce, showToast)
 *   uniboxCompose.js    — Compose modal logic
 *   uniboxConversation.js — Thread rendering + inline reply editor
 */
import { requireAuth, getCurrentUser, signOut } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import UniboxService from "./uniboxService.js";
import { initCompose } from "./uniboxCompose.js";
import { renderConversation, renderMessagesOnly, renderMessagesHtml } from "./uniboxConversation.js";
import { formatDate, escapeHtml, debounce, showToast, getStatusChipHtml } from "./uniboxUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// UniboxUI — slim orchestrator class. Delegates compose & conversation to modules.
// ─────────────────────────────────────────────────────────────────────────────
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
      // Compose
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
      composeFmtToggle: document.getElementById("compose-fmt-toggle-btn"),
      composeLink: document.getElementById("compose-link")
    };

    this.activeFilters = { folder: "inbox", status: "all", campaign_id: null, email_account_id: null, search: "" };
    this.replies = [];
    this.selectedReply = null;
    this.user = null;
    this.isSyncing = false;
    this.bgSyncInterval = null;
    this.realtimeChannel = null;

    // Pagination
    this.currentPage = 1;
    this.itemsPerPage = 15;

    // Mutable ref object so modules can push/filter without losing the reference
    this.currentHistoryRef = { value: [] };

    // Delegate compose initialisation to its own module
    initCompose(this.elements, {
      refreshAll: () => this.refreshAll(),
      showToast: (msg, type) => this.showToast(msg, type)
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async init(user) {
    this.user = user;
    if (this.elements.authLoading) this.elements.authLoading.hidden = true;
    if (this.elements.appShell) this.elements.appShell.hidden = false;

    const name = user.user_metadata?.name || user.email.split("@")[0];
    if (this.elements.userName) this.elements.userName.textContent = name;
    if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
    if (this.elements.userAvatar) this.elements.userAvatar.textContent = name[0].toUpperCase();

    this.setupRealtime();
    await this.refreshAll();
  }

  // ── Realtime ───────────────────────────────────────────────────────────────
  setupRealtime() {
    if (this.bgSyncInterval) clearInterval(this.bgSyncInterval);
    if (this.realtimeChannel) this.realtimeChannel.unsubscribe();

    if (!this.user) { console.warn("[REALTIME] Missing user. Skipping..."); return; }

    console.log("[REALTIME] Initializing for user:", this.user.id);

    this.realtimeChannel = supabase
      .channel('unibox-global-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, (payload) => {
        console.log("REALTIME SIGNAL:", payload.eventType, payload.new || payload.old);
        const record = payload.new || payload.old;
        if (record?.user_id && record.user_id !== this.user.id) return;
        this.handleRealtimeEvent(record, payload.eventType);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log("[REALTIME] Multi-Session Sync Active");
      });

    if (!window._uniboxRealtimeHeartbeat) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const state = this.realtimeChannel?.state;
          if (state !== 'joined' && state !== 'joining') {
            this.setupRealtime();
          } else {
            this.runBackgroundSyncList(5);
          }
        }
      });
      window._uniboxRealtimeHeartbeat = true;
    }

    this.bgSyncInterval = setInterval(() => this.runBackgroundSyncList(5), 180000);
  }

  async handleRealtimeEvent(newMsg, eventType) {
    if (!newMsg) return;
    console.log(`[REALTIME-EVENT] ${eventType}:`, newMsg.id);

    const messages = await UniboxService.fetchMessages(this.activeFilters);
    this.renderThreadList(messages);

    const activeThreadId = this.selectedReply?.thread_id;
    const activeLeadId = this.selectedReply?.lead_id;
    const isMatch = (
      (newMsg.thread_id && activeThreadId && newMsg.thread_id === activeThreadId) ||
      (newMsg.lead_id && activeLeadId && newMsg.lead_id === activeLeadId)
    );

    if (isMatch) {
      if (eventType === 'INSERT') await new Promise(r => setTimeout(r, 800));
      const updatedHistory = await UniboxService.fetchThreadHistory(
        activeThreadId, activeLeadId,
        this.selectedReply?.from_email,
        this.selectedReply?.to_email
      );
      this.currentHistoryRef.value = updatedHistory;
      renderMessagesOnly(this.currentHistoryRef.value);
    }
  }

  handleIncomingRealtimeMessage(newMsg) {
    if (this.currentHistoryRef.value.find(m => m.message_id === newMsg.message_id)) return;
    console.log("[REALTIME] Appending new message to active thread:", newMsg);
    this.currentHistoryRef.value.push(newMsg);
    renderMessagesOnly(this.currentHistoryRef.value);
  }

  // ── Background sync ────────────────────────────────────────────────────────
  async runBackgroundSyncList(limit = 10) {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const accounts = await UniboxService.fetchEmailAccounts();
      if (!accounts.length) return;
      const activeId = this.activeFilters.email_account_id;
      if (activeId) {
        await this.silentGmailSync(activeId, limit);
      } else {
        for (const account of accounts) await this.silentGmailSync(account.id, limit);
      }
    } catch (e) { console.warn("[BG_SYNC_LIST_FAIL]", e); }
    finally { this.isSyncing = false; }
  }

  async silentGmailSync(accountId, limit = 5) {
    const now = Date.now();
    const lastFail = this._lastSyncFail?.[accountId] || 0;
    if (now - lastFail < 300000) { console.debug(`[SILENT_SYNC] Cooldown for ${accountId}`); return; }

    try {
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !refreshData?.session) return;
      const session = refreshData.session;

      const { error } = await supabase.functions.invoke('fetch-gmail-emails', {
        body: { accountId, limit },
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (error) {
        // 546 = Edge Function timeout/OOM — transient, don't spam console
        const is546 = error?.message?.includes('546') || error?.status === 546;
        if (is546) {
          console.debug(`[SILENT_SYNC] Edge Function timeout for ${accountId} — backing off 15min`);
          if (!this._lastSyncFail) this._lastSyncFail = {};
          this._lastSyncFail[accountId] = Date.now() + 600000; // extra 10min on top of the 5min guard
        } else {
          console.warn(`[SILENT_SYNC_FAIL] ${accountId}:`, error);
          if (!this._lastSyncFail) this._lastSyncFail = {};
          this._lastSyncFail[accountId] = Date.now();
        }
      }
    } catch (e) {
      console.warn("[SILENT_SYNC_FAIL]", e);
      if (!this._lastSyncFail) this._lastSyncFail = {};
      this._lastSyncFail[accountId] = Date.now();
    }
  }

  // ── Data refresh ───────────────────────────────────────────────────────────
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
    this.renderStatusCounts(); // non-blocking, decorative
  }

  /** Fetch and inject count badges for each status filter button */
  async renderStatusCounts() {
    try {
      const counts = await UniboxService.fetchStatusCounts();
      document.querySelectorAll(".filter-item[data-status], .dropdown-item[data-status]").forEach(el => {
        const status = el.dataset.status;
        if (!status || status === 'all') return;
        const count = counts[status] || 0;
        // Remove old badge if present
        el.querySelector(".count-badge")?.remove();
        if (count > 0) {
          const badge = document.createElement("span");
          badge.className = "count-badge";
          badge.textContent = count;
          el.appendChild(badge);
        }
      });
    } catch (e) {
      console.warn("[Unibox] renderStatusCounts failed:", e);
    }
  }

  // ── Thread list rendering ──────────────────────────────────────────────────
  renderThreadList(messages, resetPage = true) {
    this.replies = messages;
    if (!this.elements.threadList) return;

    if (resetPage) this.currentPage = 1;

    const paginationEl = document.getElementById("unibox-pagination");
    const prevBtn = document.getElementById("btn-prev-page");
    const nextBtn = document.getElementById("btn-next-page");
    const pageInfo = document.getElementById("page-info");

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
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    const totalPages = Math.ceil(messages.length / this.itemsPerPage) || 1;
    if (this.currentPage > totalPages) this.currentPage = totalPages;

    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const itemsToRender = messages.slice(startIndex, startIndex + this.itemsPerPage);

    this.elements.threadList.innerHTML = itemsToRender.map(msg => {
      // Resolve status: prefer linked lead status, then reply tag
      const status = msg.lead?.status || msg.tags?.status || null;
      const chipHtml = getStatusChipHtml(status);
      return `
      <div class="thread-item ${msg.is_read ? '' : 'unread'} ${this.selectedReply?.id === msg.id ? 'active' : ''}" data-id="${msg.id}">
        <div class="thread-header">
          <span class="thread-sender">
            ${escapeHtml(msg.from_name || msg.from_email)}
            ${!msg.is_read ? '<span class="new-badge">New</span>' : ''}
          </span>
          <span class="thread-time">${formatDate(msg.received_at)}</span>
        </div>
        <div class="thread-subject">${escapeHtml(msg.subject || "(No Subject)")}</div>
        <div class="thread-snippet">${escapeHtml(msg.snippet || msg.body_text?.substring(0, 80) || "")}</div>
        ${chipHtml ? `<div class="thread-status-row">${chipHtml}</div>` : ''}
      </div>`;
    }).join("");

    if (paginationEl && prevBtn && nextBtn && pageInfo) {
      if (messages.length <= this.itemsPerPage) {
        paginationEl.style.display = 'none';
      } else {
        paginationEl.style.display = 'flex';
        pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
        prevBtn.disabled = this.currentPage === 1;
        nextBtn.disabled = this.currentPage === totalPages;
      }
    }
  }

  changePage(delta) {
    const totalPages = Math.ceil(this.replies.length / this.itemsPerPage) || 1;
    const newPage = this.currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
      this.currentPage = newPage;
      this.renderThreadList(this.replies, false);
      this.elements.threadList.scrollTop = 0;
    }
  }

  renderCampaigns(campaigns) {
    if (!this.elements.campaignFilters) return;
    this.elements.campaignFilters.innerHTML = campaigns.map(c => `
      <button class="filter-item ${this.activeFilters.campaign_id === c.id ? 'active' : ''}" data-campaign-id="${c.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary); opacity: 0.7;"><circle cx="12" cy="12" r="3"/></svg>
        <span>${escapeHtml(c.name)}</span>
      </button>
    `).join("");
  }

  renderAccounts(accounts) {
    if (!this.elements.accountFilters) return;
    this.elements.accountFilters.innerHTML = accounts.map(a => `
      <button class="filter-item ${this.activeFilters.email_account_id === a.id ? 'active' : ''}" data-account-id="${a.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>${escapeHtml(a.email_address)}</span>
      </button>
    `).join("");
  }

  updateSearchVisibility() {
    const isAllInboxesView = !this.activeFilters.email_account_id && !this.activeFilters.campaign_id;
    const isInboxFolder = this.activeFilters.folder === 'inbox' && this.activeFilters.status === 'all';
    if (this.elements.globalSearchContainer) {
      this.elements.globalSearchContainer.classList.toggle("hidden", !(isAllInboxesView && isInboxFolder));
    }
  }

  updateMiddlePaneTabsVisibility() {
    if (!this.elements.middlePaneTabs) return;
    const isAccountSelected = !!this.activeFilters.email_account_id;
    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.style.display = isAccountSelected ? 'flex' : 'none';
    }
  }

  // ── Conversation render (delegates to module) ──────────────────────────────
  async renderConversation(msg) {
    this.selectedReply = msg;
    await renderConversation(msg, {
      contentView: this.elements.contentView,
      currentHistoryRef: this.currentHistoryRef,
      replies: this.replies,
      renderThreadList: (msgs) => this.renderThreadList(msgs),
      _showToast: (m, t) => this.showToast(m, t)
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  showToast(message, type = "info") {
    showToast(message, type);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller & Event Listeners
// ─────────────────────────────────────────────────────────────────────────────
async function initUnibox() {
  const ui = new UniboxUI();
  try {
    const session = await requireAuth();
    if (!session) return;
    const user = await getCurrentUser();
    await ui.init(user);
    setupEventListeners(ui);
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
  document.addEventListener("click", () => moreContainer?.classList.remove("active"));

  // ── Shared status filter handler ──────────────────────────────────────────
  async function applyStatusFilter(status, ui) {
    clearAllActive();
    // Mark the correct button active
    const btn = document.querySelector(
      `.filter-item[data-status="${status}"], .dropdown-item[data-status="${status}"]`
    );
    if (status === 'all') {
      document.querySelector('.filter-item[data-status="all"]')?.classList.add('active');
    } else if (btn) {
      // For More dropdown items, also mark the More button active
      const isDropdown = btn.classList.contains('dropdown-item');
      if (isDropdown) document.getElementById('more-btn')?.classList.add('active');
      else btn.classList.add('active');
    }
    ui.activeFilters.status = status;
    ui.activeFilters.folder = 'inbox';
    ui.activeFilters.campaign_id = null;
    ui.activeFilters.email_account_id = null;
    const filtered = await UniboxService.fetchMessages(ui.activeFilters);
    ui.renderThreadList(filtered);
    ui.updateSearchVisibility();
    // Close More dropdown
    document.getElementById('status-more-container')?.classList.remove('active');
  }

  // 1. Status Filters — top buttons
  document.querySelectorAll("#status-filters .filter-item[data-status]").forEach(btn => {
    btn.addEventListener("click", () => applyStatusFilter(btn.dataset.status, ui));
  });

  // 1b. Status Filters — More Labels dropdown items
  document.querySelectorAll("#more-dropdown-menu .dropdown-item[data-status]").forEach(item => {
    item.addEventListener("click", () => applyStatusFilter(item.dataset.status, ui));
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

  // 3. Global Search
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
    ui.renderThreadList(filtered, true); // True to reset to page 1 on search
  });

  // 5. Click delegation for dynamic elements
  document.body.addEventListener("click", async (e) => {
    // Campaign Filter
    const campBtn = e.target.closest(".filter-item[data-campaign-id]");
    if (campBtn) {
      clearAllActive(ui);
      campBtn.classList.add("active");
      ui.activeFilters.campaign_id = campBtn.dataset.campaignId;
      ui.activeFilters.email_account_id = null;
      ui.activeFilters.status = "all";
      ui.activeFilters.folder = "inbox";
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
    }

    // Account Filter
    const accBtn = e.target.closest(".filter-item[data-account-id]");
    if (accBtn) {
      clearAllActive(ui);
      accBtn.classList.add("active");
      ui.activeFilters.email_account_id = accBtn.dataset.accountId;
      ui.activeFilters.campaign_id = null;
      ui.activeFilters.status = "all";
      ui.activeFilters.folder = "inbox";
      ui.elements.middlePaneTabs?.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.folder === "inbox");
      });
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
      ui.updateSearchVisibility();
      ui.updateMiddlePaneTabsVisibility();
    }

    // Middle Pane Tab (Inbox/Sent)
    const tabBtn = e.target.closest(".tab-btn[data-folder]");
    if (tabBtn) {
      ui.elements.middlePaneTabs?.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      tabBtn.classList.add("active");
      ui.activeFilters.folder = tabBtn.dataset.folder;
      const filtered = await UniboxService.fetchMessages(ui.activeFilters);
      ui.renderThreadList(filtered);
    }

    // Sync Selected Account
    const refreshBtn = e.target.closest("#refresh-account-btn");
    if (refreshBtn) {
      if (!ui.activeFilters.email_account_id) {
        ui.showToast("Please select a specific email account to sync, or use 'Sync All'.", "warning");
        return;
      }
      refreshBtn.classList.add("spinning");
      ui.showToast("Fetching real emails from Gmail...", "info");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("No active session. Please log in again.");
        const { data, error } = await supabase.functions.invoke('fetch-gmail-emails', {
          body: { accountId: ui.activeFilters.email_account_id },
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (error) throw error;
        console.log("[SYNC_SUCCESS]", data);
        const filtered = await UniboxService.fetchMessages(ui.activeFilters);
        ui.renderThreadList(filtered);
        ui.showToast("Success! Real emails synced from Gmail.", "success");
      } catch (err) {
        console.error("[SYNC_CRITICAL]", err);
        let errorMsg = err.message;
        if (err.message?.includes("Failed to send a request") || err.message?.includes("502")) {
          errorMsg = "Sync timed out. Please try again in 30 seconds.";
        } else if (err.context?.json) {
          errorMsg = err.context.json.error || errorMsg;
        }
        ui.showToast(`Sync failed: ${errorMsg}`, "error");
      } finally {
        refreshBtn.classList.remove("spinning");
      }
    }

    // Sync All
    const syncAllBtn = e.target.closest("#sync-all-btn");
    if (syncAllBtn) {
      syncAllBtn.classList.add("spinning");
      ui.showToast("Syncing all accounts... this may take a moment", "info");
      try {
        const accounts = await UniboxService.fetchEmailAccounts();
        if (!accounts.length) { ui.showToast("No connected accounts found.", "warning"); return; }
        let successCount = 0, failCount = 0;
        for (const account of accounts) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) continue;
            await supabase.functions.invoke('fetch-gmail-emails', {
              body: { accountId: account.id },
              headers: { Authorization: `Bearer ${session.access_token}` }
            });
            successCount++;
          } catch (err) { console.error(`[SYNC_ALL] Failed for ${account.email_address}:`, err); failCount++; }
        }
        const filtered = await UniboxService.fetchMessages(ui.activeFilters);
        ui.renderThreadList(filtered);
        ui.showToast(failCount === 0 ? `Synced ${successCount} accounts.` : `Synced ${successCount}, ${failCount} failed.`, failCount === 0 ? "success" : "warning");
      } catch (err) {
        console.error("[SYNC_ALL_CRITICAL]", err);
        ui.showToast("Global sync failed. Check console for details.", "error");
      } finally {
        syncAllBtn.classList.remove("spinning");
      }
    }

    // Pagination Clicks
    const prevBtn = e.target.closest("#btn-prev-page");
    const nextBtn = e.target.closest("#btn-next-page");
    if (prevBtn && !prevBtn.disabled) ui.changePage(-1);
    if (nextBtn && !nextBtn.disabled) ui.changePage(1);

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

    // Close dropdowns on outside click
    if (!e.target.closest(".dropdown")) {
      document.querySelectorAll(".dropdown").forEach(d => d.classList.remove("active"));
    }
  });

  // 6. Lead Status Update (delegated from body — legacy path, conversation module now handles directly)
  document.body.addEventListener("change", async (e) => {
    if (e.target.id === "lead-status-select") {
      const leadId = e.target.dataset.leadId;
      const status = e.target.value;
      try {
        const isStopping = await UniboxService.updateLeadStatus(leadId, status);
        ui.showToast(`Status updated: ${status}${isStopping ? ' (Campaign Stopped)' : ''}`, "success");
        const filtered = await UniboxService.fetchMessages(ui.activeFilters);
        ui.renderThreadList(filtered);
        ui.renderStatusCounts(); // Keep badges in sync
      } catch (err) {
        ui.showToast("Failed to update status", "error");
      }
    }
  });
}

function clearAllActive() {
  document.querySelectorAll(".unibox-filters .filter-item").forEach(b => b.classList.remove("active"));
}

initUnibox();
