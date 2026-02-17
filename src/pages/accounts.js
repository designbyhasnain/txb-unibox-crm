import { requireAuth, signOut, getCurrentUser } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

// ─── Constants ───────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// ─── State ───────────────────────────────────────────────────
let currentUser = null;
let accounts = [];

// ─── Auth Gate ───────────────────────────────────────────────
async function initPage() {
  const session = await requireAuth();
  if (!session) return;

  document.getElementById("auth-loading").hidden = true;
  document.getElementById("app-shell").hidden = false;

  currentUser = await getCurrentUser();
  if (currentUser) {
    const name = currentUser.user_metadata?.name || currentUser.email.split("@")[0];
    const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2);
    document.getElementById("user-name").textContent = name;
    document.getElementById("user-email").textContent = currentUser.email;
    document.getElementById("user-avatar").textContent = initials;
  }

  // Check for OAuth callback success/error in URL params
  handleOAuthCallback();

  // Load accounts
  await loadAccounts();

  // Initialize event listeners
  initEventListeners();
}

// ─── Handle OAuth Callback ───────────────────────────────────
function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("success") === "gmail") {
    showToast("Gmail account connected successfully!", "success");
    // Clean URL
    window.history.replaceState({}, "", "/accounts.html");
  }

  if (params.get("error")) {
    const errorMsg = decodeURIComponent(params.get("error"));
    showToast(`Error: ${errorMsg}`, "error");
    window.history.replaceState({}, "", "/accounts.html");
  }
}

// ─── Load Accounts ───────────────────────────────────────────
async function loadAccounts() {
  const tableLoading = document.getElementById("table-loading");
  const emptyState = document.getElementById("empty-state");
  const accountsTable = document.getElementById("accounts-table");

  try {
    const { data, error } = await supabase
      .from("email_accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    accounts = data || [];

    tableLoading.hidden = true;

    if (accounts.length === 0) {
      emptyState.hidden = false;
      accountsTable.hidden = true;
    } else {
      emptyState.hidden = true;
      accountsTable.hidden = false;
      renderAccountsTable();
    }
  } catch (err) {
    console.error("Error loading accounts:", err);
    tableLoading.hidden = true;
    showToast("Failed to load email accounts.", "error");
  }
}

// ─── Render Accounts Table ───────────────────────────────────
function renderAccountsTable() {
  const tbody = document.getElementById("accounts-tbody");
  tbody.innerHTML = accounts.map((acc) => {
    const statusClass = acc.status === "Active" ? "status-active" :
                        acc.status === "Error" ? "status-error" : "status-inactive";
    const providerIcon = getProviderIcon(acc.provider);

    return `
      <tr data-id="${acc.id}">
        <td>
          <div class="email-cell">
            ${providerIcon}
            <span>${escapeHtml(acc.email_address)}</span>
          </div>
        </td>
        <td><span class="provider-tag">${escapeHtml(acc.provider)}</span></td>
        <td>${escapeHtml(acc.display_name || "—")}</td>
        <td>${acc.daily_limit || 50}</td>
        <td><span class="status-badge ${statusClass}">${acc.status}</span></td>
        <td>
          <div class="action-cell">
            <button class="btn-icon btn-delete" data-id="${acc.id}" title="Remove account">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Attach delete handlers
  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteAccount(btn.dataset.id));
  });
}

function getProviderIcon(provider) {
  if (provider === "Gmail") {
    return `<div class="provider-dot gmail-dot"></div>`;
  } else if (provider === "Outlook") {
    return `<div class="provider-dot outlook-dot"></div>`;
  }
  return `<div class="provider-dot smtp-dot"></div>`;
}

// ─── Gmail OAuth ─────────────────────────────────────────────
async function startGmailOAuth() {
  try {
    // Get current session token to pass as state
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast("Please log in again.", "error");
      return;
    }

    // Redirect to our Edge Function that initiates the Google OAuth flow
    const authUrl = `${SUPABASE_URL}/functions/v1/gmail-auth-start?token=${encodeURIComponent(session.access_token)}`;
    window.location.href = authUrl;
  } catch (err) {
    showToast("Failed to start Gmail connection.", "error");
    console.error(err);
  }
}

// ─── Custom SMTP Account Creation ────────────────────────────
async function handleSmtpSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("smtp-error");
  const submitBtn = document.getElementById("smtp-submit");
  const btnText = submitBtn.querySelector(".btn-text");
  const btnLoader = submitBtn.querySelector(".btn-loader");

  errorEl.hidden = true;

  const email = document.getElementById("smtp-email").value.trim();
  const displayName = document.getElementById("smtp-display-name").value.trim();
  const smtpHost = document.getElementById("smtp-host").value.trim();
  const smtpPort = parseInt(document.getElementById("smtp-port").value);
  const smtpUsername = document.getElementById("smtp-username").value.trim();
  const smtpPassword = document.getElementById("smtp-password").value;
  const imapHost = document.getElementById("imap-host").value.trim();
  const imapPort = parseInt(document.getElementById("imap-port").value);

  // Validation: check for duplicate email
  const existing = accounts.find((a) => a.email_address.toLowerCase() === email.toLowerCase());
  if (existing) {
    errorEl.textContent = "This email address is already connected.";
    errorEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  btnText.hidden = true;
  btnLoader.hidden = false;

  try {
    const { data, error } = await supabase.from("email_accounts").insert({
      user_id: currentUser.id,
      email_address: email,
      display_name: displayName || null,
      provider: "SMTP",
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_username: smtpUsername,
      smtp_password: smtpPassword,
      imap_host: imapHost,
      imap_port: imapPort,
      status: "Active",
      daily_limit: 50,
    }).select().single();

    if (error) {
      // Check for unique constraint
      if (error.code === "23505") {
        throw new Error("This email address is already connected.");
      }
      throw error;
    }

    closeModal();
    showToast("SMTP account connected successfully!", "success");
    await loadAccounts();
  } catch (err) {
    errorEl.textContent = err.message || "Failed to add account.";
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    btnText.hidden = false;
    btnLoader.hidden = true;
  }
}

// ─── Delete Account ──────────────────────────────────────────
async function handleDeleteAccount(accountId) {
  if (!confirm("Are you sure you want to remove this email account?")) return;

  try {
    const { error } = await supabase.from("email_accounts").delete().eq("id", accountId);
    if (error) throw error;

    showToast("Account removed.", "success");
    await loadAccounts();
  } catch (err) {
    showToast("Failed to remove account.", "error");
    console.error(err);
  }
}

// ─── Modal Logic ─────────────────────────────────────────────
function openModal() {
  document.getElementById("modal-overlay").hidden = false;
  showStep("step-choose-provider");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("modal-overlay").hidden = true;
  document.body.style.overflow = "";
  // Reset SMTP form
  document.getElementById("smtp-form").reset();
  document.getElementById("smtp-error").hidden = true;
}

function showStep(stepId) {
  document.querySelectorAll(".modal-step").forEach((s) => (s.hidden = true));
  document.getElementById(stepId).hidden = false;
}

// ─── Toast Notifications ─────────────────────────────────────
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = type === "success"
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add("visible"));

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Utilities ───────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Event Listeners ─────────────────────────────────────────
function initEventListeners() {
  // Open modal buttons
  document.getElementById("btn-add-account").addEventListener("click", openModal);
  const emptyBtn = document.getElementById("btn-empty-add");
  if (emptyBtn) emptyBtn.addEventListener("click", openModal);

  // Close modal
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Provider selection
  document.getElementById("provider-gmail").addEventListener("click", startGmailOAuth);
  document.getElementById("provider-outlook").addEventListener("click", () => {
    showToast("Outlook integration is coming soon!", "info");
  });
  document.getElementById("provider-smtp").addEventListener("click", () => {
    showStep("step-smtp-form");
  });

  // SMTP form
  document.getElementById("smtp-back").addEventListener("click", () => {
    showStep("step-choose-provider");
  });
  document.getElementById("smtp-cancel").addEventListener("click", closeModal);
  document.getElementById("smtp-close").addEventListener("click", closeModal);
  document.getElementById("smtp-form").addEventListener("submit", handleSmtpSubmit);

  // Logout
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// ─── Init ────────────────────────────────────────────────────
initPage();
