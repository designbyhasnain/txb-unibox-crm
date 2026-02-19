/**
 * uniboxUtils.js — Pure helper functions shared across all Unibox modules.
 * No dependencies on UniboxService or UniboxUI.
 */

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

export function debounce(fn, ms) {
  let timeoutId;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Status colour map ──────────────────────────────────────────────────────
// Single source of truth used by thread chips, conversation dropdown, and CSS.
export const STATUS_COLORS = {
  'Interested':         { bg: '#dcfce7', text: '#15803d', css: 'interested' },
  'Meeting Booked':     { bg: '#dbeafe', text: '#1d4ed8', css: 'meeting-booked' },
  'Meeting Completed':  { bg: '#cffafe', text: '#0e7490', css: 'meeting-completed' },
  'Won':                { bg: '#fef9c3', text: '#a16207', css: 'won' },
  'Not Interested':     { bg: '#fee2e2', text: '#dc2626', css: 'not-interested' },
  'Lost':               { bg: '#fce7f3', text: '#be185d', css: 'lost' },
  'Out of office':      { bg: '#ffedd5', text: '#c2410c', css: 'out-of-office' },
  'Wrong person':       { bg: '#f3f4f6', text: '#6b7280', css: 'wrong-person' },
  'Replied':            { bg: '#ede9fe', text: '#7c3aed', css: 'replied' },
  'Bounced':            { bg: '#fee2e2', text: '#991b1b', css: 'bounced' },
  'Unsubscribed':       { bg: '#f3f4f6', text: '#374151', css: 'unsubscribed' },
  'Contacted':          { bg: '#e0f2fe', text: '#0369a1', css: 'contacted' },
  'Not Contacted':      { bg: '#f9fafb', text: '#9ca3af', css: 'not-contacted' },
};

/**
 * Return an HTML string for a status chip pill.
 * @param {string|null} status
 */
export function getStatusChipHtml(status) {
  if (!status) return '';
  const cfg = STATUS_COLORS[status];
  if (!cfg) return `<span class="status-chip">${escapeHtml(status)}</span>`;
  return `<span class="status-chip status-chip--${cfg.css}">${escapeHtml(status)}</span>`;
}
