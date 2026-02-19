/**
 * uniboxCompose.js — Compose modal logic.
 * Handles open/close/minimize, recipient autocomplete, send, and formatting toolbar.
 *
 * @param {object} elements - The elements map from UniboxUI
 * @param {object} callbacks - { refreshAll, showToast }
 */
import UniboxService from "./uniboxService.js";

export function initCompose(elements, { refreshAll, showToast }) {

  // ─── 1. Open Modal ────────────────────────────────────────────────────────
  elements.composeBtnMain?.addEventListener("click", async () => {
    elements.composeModal?.classList.remove("minimized");
    elements.composeModal?.classList.add("active");
    elements.composeTo?.focus();

    if (elements.composeFrom && elements.composeFrom.options.length === 0) {
      const accounts = await UniboxService.fetchEmailAccounts();
      elements.composeFrom.innerHTML = accounts.map(acc =>
        `<option value="${acc.id}">${acc.email_address}</option>`
      ).join("");
    }
  });

  // ─── 2. Close / Minimize ─────────────────────────────────────────────────
  elements.btnCloseCompose?.addEventListener("click", () => {
    elements.composeModal?.classList.remove("active");
  });

  elements.btnMinimizeCompose?.addEventListener("click", (e) => {
    e.stopPropagation();
    elements.composeModal?.classList.toggle("minimized");
  });

  // Restore from minimized state by clicking the modal bar
  elements.composeModal?.addEventListener("click", () => {
    if (elements.composeModal?.classList.contains("minimized")) {
      elements.composeModal?.classList.remove("minimized");
    }
  });

  // Prevent close when clicking inside the body
  const body = elements.composeModal?.querySelector(".compose-body");
  body?.addEventListener("click", (e) => e.stopPropagation());

  // ─── 3. Recipient Autocomplete ────────────────────────────────────────────
  let debounceTimer;
  elements.composeTo?.addEventListener("input", (e) => {
    const query = e.target.value;
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      if (query.length < 2) {
        elements.composeSuggestions?.classList.add("hidden");
        return;
      }

      const leads = await UniboxService.searchLeads(query);
      if (leads.length > 0) {
        elements.composeSuggestions.innerHTML = leads.map(lead => `
          <div class="suggestion-item" data-email="${lead.email}" data-id="${lead.id}">
            <div class="suggestion-name">${lead.first_name || ''} ${lead.last_name || ''}</div>
            <div class="suggestion-email">${lead.email}</div>
          </div>
        `).join("");
        elements.composeSuggestions.classList.remove("hidden");

        elements.composeSuggestions?.querySelectorAll(".suggestion-item").forEach(item => {
          item.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (elements.composeTo) {
              elements.composeTo.value = item.dataset.email;
              elements.composeTo.dataset.leadId = item.dataset.id;
            }
            elements.composeSuggestions?.classList.add("hidden");
          });
        });
      } else {
        elements.composeSuggestions?.classList.add("hidden");
      }
    }, 300);
  });

  // Hide suggestions on outside click
  document.addEventListener("click", (e) => {
    if (!elements.composeTo?.contains(e.target)) {
      elements.composeSuggestions?.classList.add("hidden");
    }
  });

  // ─── 4. Send Logic ────────────────────────────────────────────────────────
  elements.composeSendBtn?.addEventListener("click", async () => {
    const to = elements.composeTo?.value;
    const subject = elements.composeSubject?.value;
    const body = elements.composeEditor?.innerHTML;
    const accountId = elements.composeFrom?.value;
    const leadId = elements.composeTo?.dataset.leadId || null;

    if (!to || !subject) {
      showToast("Please fill recipients and subject", "error");
      return;
    }

    elements.composeSendBtn.textContent = "Sending...";
    elements.composeSendBtn.disabled = true;

    try {
      await UniboxService.sendEmail({ accountId, to, subject, body, leadId });
      showToast("Message sent successfully", "success");
      elements.composeModal?.classList.remove("active");

      if (elements.composeTo) elements.composeTo.value = "";
      if (elements.composeSubject) elements.composeSubject.value = "";
      if (elements.composeEditor) elements.composeEditor.innerHTML = "";

      await refreshAll();
    } catch (err) {
      console.error("Send failed", err);
      showToast("Failed to send message", "error");
    } finally {
      if (elements.composeSendBtn) {
        elements.composeSendBtn.textContent = "Send";
        elements.composeSendBtn.disabled = false;
      }
    }
  });

  // ─── 5. Formatting Toolbar & Actions (Universal Arch) ─────────────────────────────────────
  const composeFmtBar = document.getElementById("compose-fmt-bar");
  const composeFmtToggle = document.getElementById("btn-toggle-c-fmt");
  const composeEditor = elements.composeEditor;

  // Selection persistence
  let lastKnownRange = null;
  function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && composeEditor?.contains(sel.anchorNode)) {
      lastKnownRange = sel.getRangeAt(0);
    }
  }
  function restoreSelection() {
    if (lastKnownRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(lastKnownRange);
    } else {
      composeEditor?.focus();
    }
  }

  composeEditor?.addEventListener("keyup", saveSelection);
  composeEditor?.addEventListener("mouseup", saveSelection);
  composeEditor?.addEventListener("input", saveSelection);
  composeEditor?.addEventListener("focus", saveSelection);

  if (composeFmtBar && composeEditor) {
    _wireUniversalFormatting(composeEditor, composeFmtBar, saveSelection, restoreSelection);
  }

  composeFmtToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    composeFmtBar?.classList.toggle("active");
    composeEditor?.focus();
  });

  // Link
  const linkBtn = document.getElementById("compose-link-btn");
  linkBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  linkBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const url = prompt("Enter URL:", "https://");
    if (url) {
      composeEditor?.focus();
      document.execCommand('createLink', false, url);
    }
  });

  // Emoji
  const emojiBtn = document.getElementById("compose-emoji-btn");
  emojiBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  emojiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (composeEditor) {
      composeEditor.focus();
      document.execCommand("insertText", false, "😊");
    }
  });

  // Attachments
  const attachBtn = document.getElementById("compose-attach-btn");
  const fileInput = document.getElementById("compose-file-input");
  attachBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  attachBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput?.click();
  });

  fileInput?.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).map(f => f.name).join(", ");
      composeEditor?.focus();
      document.execCommand('insertHTML', false, `<div class="attachment-chip" style="display:inline-block; background:#f1f3f4; padding:2px 8px; border-radius:12px; margin:2px; font-size:12px; border:1px solid #ddd;">📎 ${files}</div>&nbsp;`);
    }
  });

  // Discard
  const discardBtn = document.getElementById("compose-discard-btn");
  discardBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  discardBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to discard this draft?")) return;
    if (composeEditor) composeEditor.innerHTML = "";
    if (elements.composeTo) elements.composeTo.value = "";
    if (elements.composeSubject) elements.composeSubject.value = "";
    composeFmtBar?.classList.remove("active");
    elements.composeModal?.classList.remove("active");
    showToast("Draft discarded", "info");
  });

  // Signature
  const signatureBtn = document.getElementById("compose-signature-btn");
  signatureBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  signatureBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const sig = `<br><br>--<br>${localStorage.getItem("user_name") || "Best Regards"}<br>Lead Outreach Specialist | TXB CRM`;
    if (composeEditor) {
      composeEditor.innerHTML += sig;
      composeEditor.dispatchEvent(new Event('input'));
      composeEditor.focus();
    }
  });

  // Internal Helper
  function _wireUniversalFormatting(editor, toolbar, saveSelection, restoreSelection) {
    const formatCommands = {
      'c-fmt-undo': 'undo',
      'c-fmt-redo': 'redo',
      'c-fmt-bold': 'bold',
      'c-fmt-italic': 'italic',
      'c-fmt-underline': 'underline',
      'c-fmt-list-num': 'insertOrderedList',
      'c-fmt-list-bullet': 'insertUnorderedList',
      'c-fmt-indent-less': 'outdent',
      'c-fmt-indent-more': 'indent',
      'c-fmt-quote': 'formatBlock',
      'c-fmt-strikethrough': 'strikeThrough',
      'c-fmt-clear': 'removeFormat'
    };

    Object.keys(formatCommands).forEach(id => {
      const btn = document.getElementById(id);
      btn?.addEventListener("mousedown", (e) => e.preventDefault());
      btn?.addEventListener("click", (e) => {
        e.stopPropagation();
        const cmd = formatCommands[id];
        document.execCommand(cmd === 'formatBlock' ? cmd : cmd, false, cmd === 'formatBlock' ? 'blockquote' : null);
        editor.focus();
      });
    });

    // Alignment
    let alignState = 0;
    const alignBtn = document.getElementById('c-fmt-align');
    alignBtn?.addEventListener("mousedown", (e) => e.preventDefault());
    alignBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      alignState = (alignState + 1) % 3;
      document.execCommand(alignState === 0 ? 'justifyLeft' : alignState === 1 ? 'justifyCenter' : 'justifyRight', false, null);
      editor.focus();
    });

    // Color picker
    const colorBtn = document.getElementById('c-fmt-color');
    const colorInput = document.getElementById('compose-color-input');
    const colorLabel = document.getElementById('c-fmt-color-label');
    colorBtn?.addEventListener("mousedown", (e) => e.preventDefault());
    colorBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      saveSelection();
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
      editor.focus();
    });

    // Font select
    const fontSelect = document.getElementById('c-fmt-font');
    fontSelect?.addEventListener("click", saveSelection);
    fontSelect?.addEventListener("change", (e) => {
      restoreSelection();
      document.execCommand('fontName', false, e.target.value);
      saveSelection();
      editor.focus();
    });

    // Size select
    const sizeSelect = document.getElementById('c-fmt-size');
    sizeSelect?.addEventListener("click", saveSelection);
    sizeSelect?.addEventListener("change", (e) => {
      restoreSelection();
      document.execCommand('fontSize', false, e.target.value);
      saveSelection();
      editor.focus();
    });
  }
}
