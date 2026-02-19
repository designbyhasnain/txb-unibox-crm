/**
 * uniboxConversation.js — Full conversation rendering + inline reply editor.
 *
 * @param {object} msg - The selected message/thread to display
 * @param {object} context - {
 *   contentView (DOM element),
 *   currentHistory (array, mutated in place),
 *   replies (array),
 *   selectedReply (ref object with .value),
 *   showToast (fn),
 *   renderThreadList (fn),
 *   escapeHtml (fn),
 *   formatDateTime (fn)
 * }
 */

import UniboxService from "./uniboxService.js";
import { escapeHtml, formatDateTime, showToast as utilShowToast } from "./uniboxUtils.js";
import { supabase } from "../lib/supabase.js";

/**
 * Render the full conversation pane for a given message.
 * Mutates context.currentHistory and updates context.contentView.innerHTML.
 */
export async function renderConversation(msg, context) {
  const {
    contentView,
    currentHistoryRef,   // { value: [] } — mutable ref
    replies,
    renderThreadList,
    _showToast            // instance's showToast bound method (keeps toast container ref)
  } = context;

  const _toast = _showToast || utilShowToast;

  // ─── Fetch thread history ─────────────────────────────────────────────────
  let history = [];
  try {
    history = await UniboxService.fetchThreadHistory(
      msg.thread_id,
      msg.lead_id,
      msg.from_email,
      msg.to_email
    );
    currentHistoryRef.value = history;
  } catch (e) {
    console.error("[UniboxConversation] History fetch failed", e);
  }

  if (history.length === 0) {
    history = [{ ...msg, type: 'received', timestamp: msg.received_at }];
    currentHistoryRef.value = history;
  }

  // ─── Resolve display email / name ─────────────────────────────────────────
  const isSent = msg.type === 'sent';
  let displayEmail = isSent ? (msg.to_email || msg.lead?.email) : msg.from_email;

  if (isSent && !displayEmail) {
    const lastReceived = [...history].reverse().find(h => h.type === 'received');
    if (lastReceived) displayEmail = lastReceived.from_email;
  }

  if (!displayEmail) displayEmail = "Unknown Recipient";

  const leadName = msg.lead
    ? (`${msg.lead.first_name || ""} ${msg.lead.last_name || ""}`.trim() || displayEmail)
    : (isSent ? (msg.to_email || "Recipient") : (msg.from_name || msg.from_email));

  if (!contentView) return;

  // Resolve status: linked lead wins, fall back to reply tag (for unlinked threads)
  const resolvedStatus = msg.lead?.status || msg.tags?.status || null;

  // ─── Render HTML ──────────────────────────────────────────────────────────
  contentView.innerHTML = `

    <header class="conversation-header">
      <div class="lead-info">
        <h2>${escapeHtml(leadName)}</h2>
        <div class="lead-meta">
          <span style="color: var(--primary); font-weight: 700;">${escapeHtml(displayEmail)}</span>
          <span>•</span>
          <span>Campaign: <strong>${escapeHtml(msg.campaign?.name || "Direct")}</strong></span>
        </div>
      </div>
      <div class="lead-actions" style="display: flex; align-items: center; gap: 10px;">
        <select class="status-dropdown" id="lead-status-select" data-lead-id="${msg.lead_id}">
          <option value="" ${!resolvedStatus ? 'selected' : ''} disabled>Set status…</option>
          <option value="Replied" ${resolvedStatus === 'Replied' ? 'selected' : ''}>Replied</option>
          <option value="Interested" ${resolvedStatus === 'Interested' ? 'selected' : ''}>Interested</option>
          <option value="Meeting Booked" ${resolvedStatus === 'Meeting Booked' ? 'selected' : ''}>Meeting Booked</option>
          <option value="Won" ${resolvedStatus === 'Won' ? 'selected' : ''}>Won</option>
          <option value="Not Interested" ${resolvedStatus === 'Not Interested' ? 'selected' : ''}>Not Interested</option>
          <option value="Lost" ${resolvedStatus === 'Lost' ? 'selected' : ''}>Lost</option>
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
    <div class="messages-container scrollable" id="messages-container">
      ${renderMessagesHtml(currentHistoryRef.value)}
    </div>

    <div class="reply-editor">
      <div class="gmail-editor" id="reply-container" data-recipient="${escapeHtml(displayEmail)}">
        <!-- Header -->
        <div class="gmail-editor-header">
          <div class="header-recipient">
            <svg class="header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 5 5v3"/></svg>
            <svg class="header-icon-small" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
            <span class="recipient-info" title="Replying to: ${escapeHtml(displayEmail)}">
              ${escapeHtml(leadName)} &lt;${escapeHtml(displayEmail)}&gt;
            </span>
          </div>
          <div class="gmail-header-right">
            <span class="draft-pill" id="draft-saved-pill">Draft Saved</span>
            <svg class="header-icon clickable" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </div>
        </div>

        <div class="gmail-editor-body">
          <div id="reply-text" contenteditable="true" data-placeholder="Write a reply..." class="gmail-rich-editor" style="font-family: 'Tahoma', sans-serif;"></div>
        </div>

        <!-- Formatting Bar -->
        <div class="gmail-formatting-bar pill-toolbar" id="gmail-fmt-bar">
          <div class="fmt-group">
            <div class="fmt-btn" id="fmt-undo" title="Undo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V3h4"/><path d="M3 3c5.5 0 10 4.5 10 10s-4.5 10-10 10"/></svg></div>
            <div class="fmt-btn" id="fmt-redo" title="Redo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7V3h-4"/><path d="M21 3c-5.5 0-10 4.5-10 10s4.5 10 10 10"/></svg></div>
          </div>
          <div class="fmt-group">
            <select class="fmt-select" id="fmt-font" title="Font">
              <option value="Inter" selected>Inter</option>
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Tahoma">Tahoma</option>
              <option value="monospace">Mono</option>
            </select>
            <select class="fmt-size-select" id="fmt-size" title="Font size">
              <option value="1">Small</option>
              <option value="3" selected>Normal</option>
              <option value="4">Large</option>
              <option value="5">Larger</option>
              <option value="6">XL</option>
              <option value="7">Huge</option>
            </select>
          </div>
          <div class="fmt-group">
            <div class="fmt-btn" style="font-weight:700;font-size:15px;" id="fmt-bold" title="Bold">B</div>
            <div class="fmt-btn" style="font-style:italic;font-size:15px;" id="fmt-italic" title="Italic">I</div>
            <div class="fmt-btn" style="text-decoration:underline;font-size:15px;" id="fmt-underline" title="Underline">U</div>
            <div class="fmt-btn" id="fmt-strikethrough" title="Strikethrough"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg></div>
            <!-- Color button: input sits inside the div so the picker opens near the button -->
            <div class="fmt-btn" id="fmt-color" title="Text color" style="gap:2px;">
              <span id="fmt-color-label" style="border-bottom: 3px solid #ea4335; line-height:1;">A</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
              <input type="color" id="reply-color-input" value="#ea4335"
                style="position:absolute;top:100%;left:0;width:1px;height:1px;opacity:0;border:none;padding:0;">
            </div>
          </div>
          <div class="fmt-group">
            <div class="fmt-btn" id="fmt-align" title="Align left/center/right">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
            </div>
            <div class="fmt-btn" id="fmt-list-num" title="Numbered list"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/></svg></div>
            <div class="fmt-btn" id="fmt-list-bullet" title="Bulleted list"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg></div>
            <div class="fmt-btn" id="fmt-indent-less" title="Decrease indent"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><line x1="18" y1="12" x2="6" y2="12"/></svg></div>
            <div class="fmt-btn" id="fmt-indent-more" title="Increase indent"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><line x1="6" y1="12" x2="18" y2="12"/></svg></div>
            <div class="fmt-btn" id="fmt-quote" title="Block quote"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5H3v8h4c0 2-2 4-4 4"/><path d="M14 21c3 0 7-1 7-8V5h-7v8h4c0 2-2 4-4 4"/></svg></div>
          </div>
          <div class="fmt-group" style="border-right:none;">
            <div class="fmt-btn" id="fmt-clear" title="Clear formatting"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/><line x1="15" y1="15" x2="9" y2="21"/></svg></div>
          </div>
        </div>

        <!-- Footer -->
        <div class="gmail-editor-footer">
          <div class="gmail-toolbar-left">
            <div class="gmail-send-group">
              <button class="gmail-btn-send" id="btn-send-reply">Send</button>
              <div class="send-separator"></div>
              <button class="gmail-btn-send-dropdown"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
            </div>
            <div class="gmail-toolbar-icons">
              <div class="toolbar-icon" id="btn-toggle-fmt" title="Formatting options"><span style="font-size: 16px; font-family: 'Tahoma', sans-serif; font-weight: 500; color: #5f6368;">Aa</span></div>
              <div class="toolbar-icon" id="btn-attach" title="Attach files"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></div>
              <div class="toolbar-icon" id="btn-insert-link" title="Insert link"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
              <div class="toolbar-icon" id="btn-emoji" title="Insert emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg></div>
              <div class="toolbar-icon" title="Insert files using Drive"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22h6.5a2.5 2.5 0 0 0 0-5H12"/><path d="M12 22H5.5a2.5 2.5 0 0 1 0-5H12"/><path d="M12 17V2"/><path d="m5 9 7-7 7 7"/></svg></div>
              <div class="toolbar-icon" title="Insert photo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>
              <div class="toolbar-icon" title="Toggle confidential mode"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
              <div class="toolbar-icon" id="btn-signature" title="Insert signature"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
            </div>
          </div>
          <div class="gmail-toolbar-right">
            <div class="toolbar-icon" id="btn-discard" title="Discard draft">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
            </div>
          </div>
        </div>
        <!-- Hidden file inputs (outside formatting bar) -->
        <input type="file" id="reply-file-input" multiple style="display: none;">
        <input type="file" id="reply-photo-input" accept="image/*" style="display: none;">
      </div>
    </div>
  `;

  // ─── Wire up all post-render events ───────────────────────────────────────
  _wireReplyEditor(msg, currentHistoryRef, renderThreadList, replies, _toast);

  // ─── Mark as read ──────────────────────────────────────────────────────────
  if (msg.id && !msg.is_read) {
    await UniboxService.markAsRead(msg.id);
    msg.is_read = true;
    renderThreadList(replies);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private: wire all interactive reply editor events after HTML is injected
// ─────────────────────────────────────────────────────────────────────────────
function _wireReplyEditor(msg, currentHistoryRef, renderThreadList, replies, _toast) {
  const replyContainer = document.getElementById("reply-container");
  const replyText = document.getElementById("reply-text");
  const fmtBar = document.getElementById("gmail-fmt-bar");
  const draftPill = document.getElementById("draft-saved-pill");
  const threadKey = `draft_${msg.thread_id}`;

  // ── Status dropdown ────────────────────────────────────────────────────────
  const statusSelect = document.getElementById("lead-status-select");
  statusSelect?.addEventListener("change", async (e) => {
    const newStatus = e.target.value;
    _toast(`Updating status to ${newStatus}...`, "info");
    try {
      // Resolve lead_id — it may be null if the thread was synced without a lead link
      let leadId = msg.lead_id;
      if (!leadId) {
        // Try both participant emails — lead may be stored under either address
        leadId = await UniboxService.findLeadIdByEmail(msg.from_email, msg.to_email);
        if (leadId) {
          console.log('[Unibox] Resolved lead_id via email lookup:', leadId);
          msg.lead_id = leadId; // cache so subsequent changes don't re-query
        }
      }
      if (!leadId) {
        // No lead in DB for this thread — the replies table stores it without a lead link.
        // We can still tag the thread by updating the reply record's metadata.
        const tagged = await UniboxService.tagReplyWithStatus(msg.id, newStatus);
        if (tagged) {
          e.target.dataset.prev = newStatus;
          _toast(`Thread tagged as "${newStatus}" (no linked lead)`, "success");
        } else {
          _toast("This thread has no linked lead. Open the lead's profile to change their status.", "warn");
          e.target.value = e.target.dataset.prev || "";
        }
        return;
      }
      await UniboxService.updateLeadStatus(leadId, newStatus);
      e.target.dataset.prev = newStatus;
      _toast("Lead status updated successfully", "success");
    } catch (err) {
      console.error("Status update failed:", err);
      _toast("Failed to update status: " + err.message, "error");
    }
  });
  // Store initial value so we can revert on failure
  if (statusSelect) statusSelect.dataset.prev = statusSelect.value;


  // ── More dropdown toggle ──────────────────────────────────────────────────
  const moreBtn = document.getElementById("thread-more-btn");
  const moreDropdown = document.getElementById("thread-more-dropdown");
  moreBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    moreDropdown?.classList.toggle("active");
  });
  moreDropdown?.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", (e) => {
      _toast(`${e.target.getAttribute("data-action")} action triggered (Not implemented yet)`, "info");
      moreDropdown.classList.remove("active");
    });
  });
  document.addEventListener("click", (e) => {
    if (!moreDropdown?.contains(e.target)) moreDropdown?.classList.remove("active");
  });

  // ── Draft restoration ─────────────────────────────────────────────────────
  const draftContent = localStorage.getItem(threadKey);
  if (draftContent && replyText) {
    replyText.innerHTML = draftContent;
    draftPill?.classList.add("visible");
    replyContainer?.classList.add("expanded");
  }

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

  // ── Toolbar references ────────────────────────────────────────────────────
  const fmtBtn = document.getElementById("btn-toggle-fmt");
  const discardBtn = document.getElementById("btn-discard");
  const attachBtn = document.getElementById("btn-attach");
  const fileInput = document.getElementById("reply-file-input");
  const linkBtn = document.getElementById("btn-insert-link");
  const emojiBtn = document.getElementById("btn-emoji");
  const sendReplyBtn = document.getElementById("btn-send-reply");
  const signatureBtn = document.getElementById("btn-signature");
  const colorBtn = document.getElementById('fmt-color');
  const alignBtn = document.getElementById('fmt-align');
  const photoInput = document.getElementById("reply-photo-input");

  // Prevent toolbar clicks from stealing focus from editor
  [fmtBtn, attachBtn, linkBtn, emojiBtn, signatureBtn, discardBtn].forEach(tool => {
    tool?.addEventListener("mousedown", (e) => e.preventDefault());
  });

  // ── Formatting bar toggle ─────────────────────────────────────────────────
  fmtBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    fmtBar?.classList.toggle("active");
    replyContainer?.classList.add("expanded");
    replyText?.focus();
  });

  // ── Selection persistence (needed for color picker) ───────────────────────
  let lastKnownRange = null;
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && replyText?.contains(sel.anchorNode)) {
      lastKnownRange = sel.getRangeAt(0);
    }
  };
  const restoreSelection = () => {
    if (lastKnownRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(lastKnownRange);
    } else {
      replyText?.focus();
    }
  };
  replyText?.addEventListener("keyup", saveSelection);
  replyText?.addEventListener("mouseup", saveSelection);
  replyText?.addEventListener("input", saveSelection);
  replyText?.addEventListener("focus", saveSelection);

  // ── Format commands map ───────────────────────────────────────────────────
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
    'fmt-quote': 'formatBlock',
    'fmt-strikethrough': 'strikeThrough',
    'fmt-clear': 'removeFormat'
  };

  Object.keys(formatCommands).forEach(id => {
    const btn = document.getElementById(id);
    btn?.addEventListener("mousedown", (e) => e.preventDefault());
    btn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const cmd = formatCommands[id];
      document.execCommand(cmd === 'formatBlock' ? cmd : cmd, false, cmd === 'formatBlock' ? 'blockquote' : null);
      replyText?.focus();
    });
  });

  // Alignment cycle
  let alignState = 0;
  alignBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  alignBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    alignState = (alignState + 1) % 3;
    document.execCommand(alignState === 0 ? 'justifyLeft' : alignState === 1 ? 'justifyCenter' : 'justifyRight', false, null);
    replyText?.focus();
  });

  // Color picker — input is INSIDE the btn div, trigger via .click() on the input element
  const colorInput = document.getElementById("reply-color-input");
  const colorLabel = document.getElementById("fmt-color-label");
  colorBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  colorBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    saveSelection();
    // Temporarily make the input clickable to open the picker
    if (colorInput) {
      colorInput.style.pointerEvents = 'auto';
      colorInput.click();
      setTimeout(() => { colorInput.style.pointerEvents = 'none'; }, 100);
    }
  });
  colorInput?.addEventListener("input", (e) => {
    restoreSelection();
    document.execCommand('foreColor', false, e.target.value);
    if (colorLabel) colorLabel.style.borderBottomColor = e.target.value;
    saveSelection();
    replyText?.focus();
  });

  // Font select
  const fontSelect = document.getElementById('fmt-font');
  fontSelect?.addEventListener("click", saveSelection);
  fontSelect?.addEventListener("change", (e) => {
    restoreSelection();
    document.execCommand('fontName', false, e.target.value);
    saveSelection();
    replyText?.focus();
  });

  // Font size select (proper dropdown, no cycling)
  const sizeSelect = document.getElementById('fmt-size');
  sizeSelect?.addEventListener("click", saveSelection);
  sizeSelect?.addEventListener("change", (e) => {
    restoreSelection();
    document.execCommand('fontSize', false, e.target.value);
    saveSelection();
    replyText?.focus();
  });

  // ── Attachments ────────────────────────────────────────────────────────────
  attachBtn?.addEventListener("click", (e) => { e.stopPropagation(); fileInput?.click(); });
  fileInput?.addEventListener("change", (e) => {
    if (fileInput.files?.[0]) {
      replyText?.focus();
      document.execCommand('insertHTML', false, `<div class="attachment-chip" style="display:inline-block; background:#f1f3f4; padding:2px 8px; border-radius:12px; margin:2px; font-size:12px; border:1px solid #ddd;">📎 ${escapeHtml(fileInput.files[0].name)}</div>&nbsp;`);
    }
  });

  // ── Photo insert ───────────────────────────────────────────────────────────
  photoInput?.addEventListener("change", () => {
    if (photoInput.files?.[0]) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        replyText?.focus();
        document.execCommand('insertHTML', false, `<img src="${ev.target.result}" style="max-width: 100%; border-radius: 4px; margin: 10px 0;" alt="Image">`);
        replyContainer?.classList.add("expanded");
      };
      reader.readAsDataURL(photoInput.files[0]);
    }
  });

  // ── Link insert ────────────────────────────────────────────────────────────
  linkBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const url = prompt("Enter URL:", "https://");
    if (url) {
      replyText?.focus();
      document.execCommand('createLink', false, url);
      replyContainer?.classList.add("expanded");
    }
  });

  // ── Emoji ──────────────────────────────────────────────────────────────────
  emojiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (replyText) {
      replyText.focus();
      document.execCommand("insertText", false, "😊");
    }
  });

  // ── Signature ──────────────────────────────────────────────────────────────
  signatureBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  signatureBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const sig = `<br><br>--<br>${localStorage.getItem("user_name") || "Best Regards"}<br>Lead Outreach Specialist | TXB CRM`;
    if (replyText) {
      replyText.innerHTML += sig;
      replyText.dispatchEvent(new Event('input'));
      replyText?.focus();
    }
  });

  // ── Expand on click ───────────────────────────────────────────────────────
  replyContainer?.addEventListener("click", (e) => {
    if (!e.target.closest('.gmail-formatting-bar')) {
      replyContainer?.classList.add("expanded");
      replyText?.focus();
    }
  });

  // ── Discard ────────────────────────────────────────────────────────────────
  discardBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  discardBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to discard this draft?")) return;
    localStorage.removeItem(threadKey);
    if (replyText) replyText.innerHTML = "";
    replyContainer?.classList.remove("expanded");
    fmtBar?.classList.remove("active");
    draftPill?.classList.remove("visible");
    _toast("Draft discarded", "info");
  });

  // ── Keyboard shortcut: Ctrl+Enter ─────────────────────────────────────────
  replyText?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendReplyBtn?.click();
    }
  });

  // ── Send Logic ─────────────────────────────────────────────────────────────
  sendReplyBtn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const content = (replyText?.innerHTML || "").trim();
    const cleanContent = replyText?.textContent?.trim();

    if (!cleanContent && !content.includes('<img')) {
      _toast("Please enter a message", "error");
      return;
    }

    const originalBtnText = sendReplyBtn.textContent;
    sendReplyBtn.textContent = "Sending...";
    sendReplyBtn.disabled = true;

    const tempId = crypto.randomUUID();
    const optimisticMsg = {
      type: 'sent',
      from_name: 'Me',
      from_email: 'Me',
      timestamp: new Date().toISOString(),
      body_html: content,
      message_id: tempId
    };

    try {
      currentHistoryRef.value.push(optimisticMsg);
      _renderMessagesOnly(currentHistoryRef.value);

      localStorage.removeItem(threadKey);
      replyText.innerHTML = "";
      replyContainer?.classList.remove("expanded");

      if (!msg.email_account_id) {
        throw new Error("Unable to determine sending account. Please refresh and try again.");
      }

      let recipient = document.getElementById("reply-container")?.dataset.recipient;
      if (!recipient) {
        recipient = (msg.type === 'sent') ? (msg.to_email || msg.lead?.email) : msg.from_email;
      }
      if (!recipient) {
        try {
          const hist = await UniboxService.fetchThreadHistory(msg.email_account_id, msg.thread_id, msg);
          const lastReceived = [...hist].reverse().find(h => h.type === 'received');
          if (lastReceived) recipient = lastReceived.from_email;
        } catch (e) { console.warn("Fallback recipient lookup failed", e); }
      }
      if (!recipient) throw new Error("Unable to determine recipient. Please check lead details.");

      const replyPayload = {
        accountId: msg.email_account_id,
        to: recipient,
        subject: document.getElementById("reply-subject")?.value || (msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`),
        htmlBody: content
      };

      const hexRegex = /^[0-9a-fA-F]+$/;
      if (msg.thread_id && typeof msg.thread_id === 'string' && msg.thread_id.length > 3 && hexRegex.test(msg.thread_id)) {
        replyPayload.threadId = msg.thread_id;
      }
      if (msg.message_id && typeof msg.message_id === 'string') {
        replyPayload.originalMessageId = msg.message_id;
      }

      console.log("Sending Reply Payload:", replyPayload);

      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData?.session) throw new Error("Session refresh failed. Please reload and log in again.");
      const session = refreshData.session;

      let response = await supabase.functions.invoke('send-email', {
        body: replyPayload,
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      // Retry without threadId if invalid thread error
      const errorStr = JSON.stringify(response.error || response.data?.error || '');
      if (errorStr.includes("Invalid thread_id")) {
        console.warn("[RETRY] Invalid thread_id — retrying as new conversation...");
        delete replyPayload.threadId;
        response = await supabase.functions.invoke('send-email', {
          body: replyPayload,
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
      }

      const { data, error } = response;
      if (error || (data && data.error)) {
        currentHistoryRef.value = currentHistoryRef.value.filter(m => m.message_id !== tempId);
        _renderMessagesOnly(currentHistoryRef.value);
        const errMsg = error?.message || data?.error || JSON.stringify(data) || "Failed to send";
        throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      }

      _toast("Email sent correctly!", "success");

      if (data?.id) {
        const msgInHistory = currentHistoryRef.value.find(m => m.message_id === tempId);
        if (msgInHistory) {
          msgInHistory.message_id = data.id;
          if (data.threadId) msgInHistory.thread_id = data.threadId;
        }
      }

      localStorage.removeItem(threadKey);
      replyText.innerHTML = "";
      replyContainer?.classList.remove("expanded");

    } catch (err) {
      console.error("Send Error:", err);
      _toast(`Error: ${err.message}`, "error");
    } finally {
      sendReplyBtn.textContent = originalBtnText;
      sendReplyBtn.disabled = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported helpers also used by UniboxUI (renderMessagesOnly / renderMessagesHtml)
// ─────────────────────────────────────────────────────────────────────────────

export function renderMessagesHtml(history) {
  return history.map(item => {
    const isSent = item.type === 'sent';
    const senderName = escapeHtml(item.from_name || item.from_email || 'Unknown');
    const initial = (item.from_name?.[0] || item.from_email?.[0] || '?').toUpperCase();
    const avatarBg = isSent ? '#4285f4' : '#5f6368';
    const badgeColor = isSent ? '#174ea6' : '#3c4043';
    const badgeBg = isSent ? '#e8f0fe' : '#f1f3f4';
    const badgeText = isSent ? '↑ You' : '↓ Received';

    return `
    <div class="message-bubble ${isSent ? 'message-sent' : 'message-received'}">
      <div class="message-meta">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:32px;height:32px;border-radius:50%;background:${avatarBg};color:#fff;
            display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;
            flex-shrink:0;">${initial}</div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
              <span style="font-weight:700;font-size:0.9rem;color:var(--text-main)">${senderName}</span>
              <span style="font-size:0.7rem;font-weight:600;padding:2px 7px;border-radius:99px;
                background:${badgeBg};color:${badgeColor};">${badgeText}</span>
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted);">${formatDateTime(item.timestamp)}</span>
          </div>
        </div>
      </div>
      <div class="message-body" style="margin-top:12px;padding-left:42px;">
        ${item.body_html || item.body_text?.replace(/\n/g, '<br>') || '<em style="color:var(--text-muted)">No content</em>'}
      </div>
    </div>
  `;
  }).join("");
}

export function renderMessagesOnly(history) {
  const container = document.getElementById("messages-container");
  if (container) {
    container.innerHTML = renderMessagesHtml(history);
    container.scrollTop = container.scrollHeight;
    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
  }
}

// Internal alias used within this module
function _renderMessagesOnly(history) {
  renderMessagesOnly(history);
}
