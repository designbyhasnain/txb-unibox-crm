/**
 * uniboxService.js — Data layer. All Supabase queries and email-sending logic.
 * No DOM access. Import and use as a static class.
 */
import { supabase } from "../lib/supabase.js";

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
      return [...inbox, ...sent].sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
    }

    const isValidId = (id) => id && id !== 'undefined' && id !== 'null' && id !== '';

    // Handle Sent Folder
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

      if (isValidId(email_account_id)) query = query.eq("email_account_id", email_account_id);

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
        to_email: log.to_email || log.lead?.email || "",
        snippet: log.subject || "(No Subject)",
        type: 'sent'
      }));
    }

    // ── Handle Inbox/Replies ───────────────────────────────────────────────
    // When a status filter is active we need two passes:
    //   1. Fetch lead IDs where leads.status matches (PostgREST can't filter on
    //      joined-table columns via .eq() on the parent query).
    //   2. Also include unlinked threads tagged via replies.tags->>'status'.
    let matchingLeadIds = null;
    let taggedReplyIds   = null;

    if (status && status !== "all") {
      // Pass 1 — lead IDs with matching status
      const { data: leadRows } = await supabase
        .from("leads")
        .select("id")
        .eq("status", status);
      matchingLeadIds = (leadRows || []).map(r => r.id);

      // Pass 2 — reply IDs tagged via replies.tags column (unlinked threads)
      const { data: taggedRows } = await supabase
        .from("replies")
        .select("id")
        .eq("tags->>status", status);
      taggedReplyIds = (taggedRows || []).map(r => r.id);
    }

    let query = supabase
      .from("replies")
      .select(`
        *,
        lead:leads(*),
        campaign:campaigns(*),
        account:email_accounts(*)
      `)
      .order("received_at", { ascending: false });

    if (isValidId(email_account_id)) query = query.eq("email_account_id", email_account_id);
    if (isValidId(campaign_id))      query = query.eq("campaign_id", campaign_id);

    if (status && status !== "all") {
      // Build OR filter: replies linked to matching leads OR tagged directly
      const parts = [];
      if (matchingLeadIds?.length)  parts.push(...matchingLeadIds.map(id => `lead_id.eq.${id}`));
      if (taggedReplyIds?.length)   parts.push(...taggedReplyIds.map(id => `id.eq.${id}`));

      if (parts.length === 0) {
        // Nothing matched — return empty immediately
        return [];
      }
      query = query.or(parts.join(","));
    }

    if (folder === "unread") query = query.eq("is_read", false);

    if (search) {
      query = query.or(`from_email.ilike.%${search}%,subject.ilike.%${search}%,body_text.ilike.%${search}%,from_name.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(m => ({ ...m, type: m.type || 'received' }));
  }

  static async fetchThreadHistory(threadId, leadId, fromEmail, toEmail) {
    const isValidId = (id) => id && id !== 'undefined' && id !== 'null' && id !== '';
    if (!isValidId(threadId) && !isValidId(leadId) && !fromEmail) {
      console.warn("[UniboxService] fetchThreadHistory called without valid identifiers");
      return [];
    }

    console.log("[UniboxService] Fetching history for threadId:", threadId, "leadId:", leadId, "from:", fromEmail, "to:", toEmail);

    let query = supabase.from("replies").select("*");

    if (isValidId(threadId) && isValidId(leadId)) {
      query = query.or(`thread_id.eq.${threadId},lead_id.eq.${leadId}`);
    } else if (isValidId(threadId)) {
      console.log("[UniboxService] leadId is null, filtering by thread_id only");
      query = query.eq("thread_id", threadId);
    } else if (isValidId(leadId)) {
      query = query.eq("lead_id", leadId);
    }

    const { data: replies, error: replyError } = await query.order("received_at", { ascending: true });
    if (replyError) console.error("[UniboxService] fetchThreadHistory error:", replyError);
    console.log("DB RAW DATA FETCHED (thread query):", replies);

    let allReplies = replies || [];

    if (allReplies.length <= 1 && (fromEmail || toEmail)) {
      const emails = [fromEmail, toEmail].filter(Boolean);
      console.log("[UniboxService] Only 1 result found — expanding search by participants:", emails);

      const orFilters = [];
      if (emails[0] && emails[1]) {
        orFilters.push(`and(from_email.eq.${emails[0]},to_email.eq.${emails[1]})`);
        orFilters.push(`and(from_email.eq.${emails[1]},to_email.eq.${emails[0]})`);
      } else if (emails[0]) {
        orFilters.push(`from_email.eq.${emails[0]}`, `to_email.eq.${emails[0]}`);
      }

      if (orFilters.length > 0) {
        const { data: participantReplies, error: participantError } = await supabase
          .from("replies")
          .select("*")
          .or(orFilters.join(","))
          .order("received_at", { ascending: true });

        if (participantError) {
          console.error("[UniboxService] Participant query error:", participantError);
        } else {
          console.log("DB RAW DATA FETCHED (participant query):", participantReplies);
          allReplies = participantReplies || allReplies;
        }
      }
    }

    // Deduplicate and normalize
    const seenMessageIds = new Set();
    const history = [];

    const addMessage = (item) => {
      const msgId = item.message_id || item.id;
      if (msgId && seenMessageIds.has(msgId)) return;
      if (msgId) seenMessageIds.add(msgId);
      history.push({
        ...item,
        type: item.type || 'received',
        timestamp: item.received_at || item.created_at
      });
    };

    allReplies.forEach(r => addMessage(r));

    const finalHistory = history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    console.log(`[UniboxService] Final history count: ${finalHistory.length}`);
    return finalHistory;
  }

  static async updateLeadStatus(leadId, status) {
    if (!leadId || leadId === 'null' || leadId === 'undefined') {
      throw new Error('Cannot update lead status: leadId is null. Resolve the lead first.');
    }
    const terminalStatuses = ['Not Interested', 'Lost', 'Out of office', 'Wrong person', 'Won', 'Unsubscribed'];
    const isStopping = terminalStatuses.includes(status);

    const { error } = await supabase
      .from("leads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", leadId);

    if (error) throw error;
    return isStopping;
  }

  /**
   * Find a lead by one or more email addresses (tries each, returns first match).
   * @param {...string} emails - One or more email addresses to try
   */
  static async findLeadIdByEmail(...emails) {
    const valid = [...new Set(emails.filter(Boolean).map(e => e.trim().toLowerCase()))];
    if (!valid.length) return null;
    const orFilter = valid.map(e => `email.ilike.${e}`).join(',');
    const { data, error } = await supabase
      .from("leads")
      .select("id, email")
      .or(orFilter)
      .limit(1)
      .maybeSingle();
    if (error) { console.warn('[UniboxService] findLeadIdByEmail error:', error); return null; }
    return data?.id ?? null;
  }

  /**
   * Tag a reply/thread with a status label when no lead_id is linked.
   * Stores the tag in the replies.tags JSONB column.
   */
  static async tagReplyWithStatus(replyId, status) {
    if (!replyId) return false;
    const { error } = await supabase
      .from("replies")
      .update({ tags: { status } })
      .eq("id", replyId);
    if (error) { console.warn('[UniboxService] tagReplyWithStatus error:', error); return false; }
    return true;
  }

  /**
   * Return a map of { status → count } for all statuses that have at least
   * one linked reply. Used to populate count badges next to filter labels.
   * Combines lead-linked replies AND tag-only replies in one pass.
   */
  static async fetchStatusCounts() {
    // Fetch lead statuses joined to replies
    const { data: linkedRows } = await supabase
      .from("replies")
      .select("lead:leads(status)");

    // Fetch tag-only replies
    const { data: taggedRows } = await supabase
      .from("replies")
      .select("tags")
      .not("tags", "is", null);

    const counts = {};
    const bump = (s) => { if (s) counts[s] = (counts[s] || 0) + 1; };

    (linkedRows || []).forEach(r => bump(r.lead?.status));
    (taggedRows  || []).forEach(r => bump(r.tags?.status));

    return counts; // e.g. { Interested: 4, Won: 1, ... }
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
    const payload = {
      accountId,
      to,
      subject,
      htmlBody: body,
      leadId,
      threadId,
      originalMessageId: inReplyTo
    };

    console.log("PRE-SEND PAYLOAD:", { to: payload.to, subject: payload.subject, htmlBody: payload.htmlBody });

    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData?.session) {
        throw new Error("Session refresh failed. Please reload and log in again.");
      }
      const session = refreshData.session;

      const { data: funcData, error: funcError } = await supabase.functions.invoke('send-email', {
        body: payload,
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (funcError) {
        console.error("Edge function error:", funcError);
        throw new Error(funcError.message || "Failed to send email via provider.");
      }

      console.log("Email sent successfully via Edge Function:", funcData);
      return funcData;

    } catch (e) {
      console.warn("Edge function invoke failed:", e);
      throw e;
    }
  }
}

export default UniboxService;
