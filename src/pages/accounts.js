import { requireAuth, signOut, getCurrentUser } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

/**
 * AccountService — Handles all data fetching and Supabase transitions.
 * No DOM logic allowed here.
 */
class AccountService {
  /**
   * Fetch even more details about accounts.
   */
  static async fetchAccounts() {
    console.log("📂 AccountService: Fetching accounts...");
    const { data, error } = await supabase
      .from("email_accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Delete an account by ID.
   */
  static async deleteAccount(id) {
    const { error } = await supabase.from("email_accounts").delete().eq("id", id);
    if (error) throw error;
  }

  /**
   * Test SMTP Connection via Edge Function.
   */
  static async testSmtpConnection(params) {
    console.log("🧪 AccountService: Testing SMTP connection...");
    const { data, error } = await supabase.functions.invoke("smtp-tester", {
      body: params,
    });
    if (error) throw error;
    if (!data.success) throw new Error(data.message || "Connection failed");
    return data;
  }

  /**
   * Create an SMTP account.
   */
  static async createSmtpAccount(accountData) {
    console.log("💾 AccountService: Saving SMTP account...");
    const { data, error } = await supabase.from("email_accounts").insert(accountData).select().single();
    if (error) throw error;
    return data;
  }
}

/**
 * AccountUI — Handles all rendering, DOM updates, and UI feedback.
 */
class AccountUI {
  constructor() {
    this.accounts = [];
    this.currentUser = null;
    
    // Bindings
    this.elements = {
      tbody: document.getElementById("accounts-tbody"),
      table: document.getElementById("accounts-table"),
      loading: document.getElementById("table-loading"),
      empty: document.getElementById("empty-state"),
      authLoading: document.getElementById("auth-loading"),
      appShell: document.getElementById("app-shell"),
      userName: document.getElementById("user-name"),
      userEmail: document.getElementById("user-email"),
      userAvatar: document.getElementById("user-avatar"),
      gmailLink: document.getElementById("gmail-direct-link"),
      modalOverlay: document.getElementById("modal-overlay"),
      smtpForm: document.getElementById("smtp-form")
    };
  }

  /**
   * Initialize User Info in the UI
   */
  renderUserInfo(user) {
    if (!user) return;
    this.currentUser = user;
    const name = user.user_metadata?.name || user.email.split("@")[0];
    const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
    
    if (this.elements.userName) this.elements.userName.textContent = name;
    if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
    if (this.elements.userAvatar) this.elements.userAvatar.textContent = initials;
  }

  /**
   * Reveal App shell
   */
  showApp() {
    if (this.elements.authLoading) {
      this.elements.authLoading.hidden = true;
      this.elements.authLoading.style.display = "none";
    }
    if (this.elements.appShell) this.elements.appShell.hidden = false;
  }

  /**
   * Render the accounts table
   */
  renderTable(accounts) {
    this.accounts = accounts;
    
    if (this.elements.loading) this.elements.loading.hidden = true;
    
    if (accounts.length === 0) {
      if (this.elements.empty) this.elements.empty.hidden = false;
      if (this.elements.table) this.elements.table.hidden = true;
      return;
    }

    if (this.elements.empty) this.elements.empty.hidden = true;
    if (this.elements.table) {
      this.elements.table.hidden = false;
      this.elements.table.style.display = "table";
    }

    if (!this.elements.tbody) return;

    this.elements.tbody.innerHTML = accounts.map(acc => this.generateRowHtml(acc)).join("");
  }

  generateRowHtml(acc) {
    const statusClass = acc.status === "Active" ? "status-active" : 
                        acc.status === "Error" ? "status-error" : "status-inactive";
    
    const usagePercent = 10; // Placeholder for now, could be (acc.sent_today / acc.daily_limit) * 100
    
    return `
      <tr data-id="${acc.id}">
        <td>
          <div class="email-cell">
            <span style="font-weight: 600; color: var(--text-main);">${this.escapeHtml(acc.email_address)}</span>
          </div>
        </td>
        <td>
          <span class="status-badge" style="background: var(--bg-main); color: var(--text-muted); border: 1px solid var(--border);">
            ${this.escapeHtml(acc.provider)}
          </span>
        </td>
        <td><span style="color: var(--text-secondary);">${this.escapeHtml(acc.display_name || "—")}</span></td>
        <td>
           <div class="usage-bar-container">
             <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; font-weight: 500;">
               <span>${acc.daily_limit || 50} limit</span>
               <span>${usagePercent}%</span>
             </div>
             <div class="usage-bar-outer">
               <div class="usage-bar-inner" style="width: ${usagePercent}%;"></div>
             </div>
           </div>
        </td>
        <td><span class="status-badge ${statusClass}">${acc.status === 'Active' ? 'Connected' : acc.status}</span></td>
        <td>
          <button class="btn-delete" data-id="${acc.id}" style="padding: 6px; background: none; border: none; color: var(--text-muted); cursor: pointer; transition: var(--transition);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </td>
      </tr>
    `;
  }

  updateGmailLink(authUrl) {
    if (this.elements.gmailLink) this.elements.gmailLink.href = authUrl;
  }

  closeModal() {
    if (this.elements.modalOverlay) this.elements.modalOverlay.hidden = true;
    if (this.elements.smtpForm) this.elements.smtpForm.reset();
    
    // Reset modal steps
    const step1 = document.getElementById("step-choose-provider");
    const step2 = document.getElementById("step-smtp-form");
    if (step1) step1.hidden = false;
    if (step2) step2.hidden = true;
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add("visible"), 10);
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }
}

/**
 * Controller — Orchestrates Service and UI.
 */
async function initApp() {
  const ui = new AccountUI();
  
  try {
    const session = await requireAuth();
    if (!session) return;

    ui.showApp();
    const user = await getCurrentUser();
    ui.renderUserInfo(user);

    // Initial Load
    const accounts = await AccountService.fetchAccounts();
    ui.renderTable(accounts);

    // Setup Gmail Link
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jkmfyuduxhkkrdxcfhbn.supabase.co";
    const authUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/gmail-auth-start?token=${encodeURIComponent(session.access_token)}`;
    ui.updateGmailLink(authUrl);

    // Check for Redirect Messages (Success/Error)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("success")) {
      const successType = urlParams.get("success");
      if (successType === "gmail") {
        ui.showToast("Gmail account connected successfully!", "success");
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Refresh list
        const updatedAccounts = await AccountService.fetchAccounts();
        ui.renderTable(updatedAccounts);
      }
    } else if (urlParams.has("error")) {
      const errorMsg = urlParams.get("error");
      ui.showToast(`Connection failed: ${decodeURIComponent(errorMsg)}`, "error");
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Event Listeners
    setupEventListeners(ui, session.access_token);
  } catch (err) {
    console.error("Initialization Failed:", err);
    ui.showApp();
    ui.showToast("Critical Error: Link to database failed.", "error");
  }
}

function setupEventListeners(ui, token) {
  // Add Account Button
  document.body.addEventListener("click", async (e) => {
    // Add Account Button - Show provider selection first
    if (e.target.closest("#btn-add-account") || e.target.closest("#btn-empty-add")) {
      document.getElementById("modal-overlay").hidden = false;
      document.getElementById("step-choose-provider").hidden = false;
      document.getElementById("step-smtp-form").hidden = true;
    }

    if (e.target.closest("#modal-close") || e.target.closest("#smtp-cancel") || e.target.closest("#smtp-close") || e.target === document.getElementById("modal-overlay")) {
      ui.closeModal();
    }

    // Back to Provider Selection
    if (e.target.closest("#smtp-back")) {
      document.getElementById("step-choose-provider").hidden = false;
      document.getElementById("step-smtp-form").hidden = true;
    }

    // Provider SMTP Selection
    if (e.target.closest("#provider-smtp")) {
       document.getElementById("step-choose-provider").hidden = true;
       document.getElementById("step-smtp-form").hidden = false;
    }

    // Gmail Connect
    if (e.target.closest("#provider-gmail")) {
       const btn = e.target.closest("#provider-gmail");
       console.log("🚀 Initiating Gmail OAuth Flow...");
       
       // UI Feedback
       const originalContent = btn.innerHTML;
       btn.classList.add("active");
       btn.style.opacity = "0.7";
       btn.style.pointerEvents = "none";
       btn.innerHTML = `
         <div class="loading-spinner-sm" style="width: 20px; height: 20px; border-width: 2px;"></div>
         <div class="provider-info" style="margin-left: 12px; text-align: left;">
           <span class="provider-name" style="display: block; font-weight: 600;">Connecting...</span>
           <span class="provider-type" style="display: block; font-size: 0.75rem; opacity: 0.8;">Redirecting to Google</span>
         </div>
       `;

       const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jkmfyuduxhkkrdxcfhbn.supabase.co";
       const targetUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/gmail-auth-start?token=${encodeURIComponent(token)}`;
       
       // Small delay to let user see feedback
       setTimeout(() => {
         window.location.href = targetUrl;
       }, 500);
    }

    // Delete
    const delBtn = e.target.closest(".btn-delete");
    if (delBtn) {
      if (!confirm("Are you sure?")) return;
      try {
        await AccountService.deleteAccount(delBtn.dataset.id);
        ui.showToast("Account removed", "success");
        const accounts = await AccountService.fetchAccounts();
        ui.renderTable(accounts);
      } catch (err) {
        ui.showToast("Delete failed", "error");
      }
    }

    // List Refresh + Sync
    if (e.target.closest("#btn-refresh-accounts")) {
      const btn = e.target.closest("#btn-refresh-accounts");
      
      console.log("🔄 Refreshing accounts list and triggering background sync...");
      btn.classList.add("spinning");
      ui.showToast("Refreshing accounts...", "info");

      try {
        const accounts = await AccountService.fetchAccounts();
        ui.renderTable(accounts);
        
        // Trigger background sync for all Gmail accounts
        const gmailAccounts = accounts.filter(a => a.refresh_token);
        if (gmailAccounts.length > 0) {
          console.log(`[SYNC] Triggering sync for ${gmailAccounts.length} Gmail accounts...`);
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          
          // Fire and forget (optional) or wait. Let's fire and forget for UI snappiness
          gmailAccounts.forEach(account => {
            supabase.functions.invoke('fetch-gmail-emails', {
              body: { accountId: account.id },
              headers: { Authorization: `Bearer ${token}` }
            }).then(({error}) => {
               if (error) console.error(`[SYNC_ERROR] ${account.email_address}:`, error);
               else console.log(`[SYNC_SUCCESS] ${account.email_address}`);
            });
          });
          ui.showToast("Background sync started for Gmail accounts.", "info");
        }
      } catch (err) {
        ui.showToast("Failed to refresh: " + err.message, "error");
      } finally {
        setTimeout(() => btn.classList.remove("spinning"), 1000);
      }
    }

    // Close Modal
    if (e.target.closest("#modal-close") || e.target.closest("#smtp-close")) {
      ui.closeModal();
    }

    // Close Modal
    if (e.target.closest(".modal-close")) {
      ui.closeModal();
    }

    // Test SMTP
    if (e.target.closest("#btn-test-smtp")) {
      const btn = e.target.closest("#btn-test-smtp");
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = "Testing...";

      try {
        const host = document.getElementById("smtp-host");
        const port = document.getElementById("smtp-port");
        const user = document.getElementById("smtp-user");
        const pass = document.getElementById("smtp-pass");
        const encryption = document.getElementById("smtp-encryption");

        console.log("Debug - Test SMTP Fields:", {
          host: host ? host.value : null,
          port: port ? port.value : null,
          user: user ? user.value : null,
          pass: pass ? (pass.value ? "[HIDDEN]" : null) : null,
          encryption: encryption ? encryption.value : null
        });

        const payload = {
          host: host.value,
          port: parseInt(port.value),
          user: user.value,
          pass: pass.value,
          encryption: encryption.value
        };

        await AccountService.testSmtpConnection(payload);
        ui.showToast("Connection Successful!", "success");
      } catch (err) {
        ui.showToast(`Test Failed: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }

    // Logout
    if (e.target.closest("#logout-btn")) {
       await signOut();
    }
  });

  // SMTP Form logic
  const smtpForm = document.getElementById("smtp-form");
  if (smtpForm) {
    smtpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById("btn-save-smtp");
      saveBtn.disabled = true;

      try {
        const emailField = document.getElementById("smtp-user");
        const nameField = document.getElementById("display-name");
        const hostField = document.getElementById("smtp-host");
        const portField = document.getElementById("smtp-port");
        const encField = document.getElementById("smtp-encryption");
        const passField = document.getElementById("smtp-pass");
        const imapHostField = document.getElementById("imap-host");
        const imapPortField = document.getElementById("imap-port");

        console.log("Debug - Save Account Fields:", {
          email: emailField ? emailField.value : null,
          display_name: nameField ? nameField.value : null,
          smtp_host: hostField ? hostField.value : null,
          smtp_port: portField ? portField.value : null,
          imap_host: imapHostField ? imapHostField.value : null,
          imap_port: imapPortField ? imapPortField.value : null
        });

        const payload = {
          user_id: (await getCurrentUser()).id,
          email_address: emailField.value,
          display_name: nameField.value,
          smtp_host: hostField.value,
          smtp_port: parseInt(portField.value),
          smtp_encryption: encField.value,
          smtp_username: emailField.value,
          smtp_password: passField.value,
          imap_host: imapHostField.value,
          imap_port: parseInt(imapPortField.value),
          imap_username: emailField.value,
          imap_password: passField.value,
          provider: "SMTP",
          status: "Active",
          daily_limit: 50
        };

        await AccountService.createSmtpAccount(payload);
        ui.closeModal();
        ui.showToast("Account connected successfully!", "success");
        
        const accounts = await AccountService.fetchAccounts();
        ui.renderTable(accounts);
      } catch (err) {
        ui.showToast(`Failed to save: ${err.message}`, "error");
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

initApp();
