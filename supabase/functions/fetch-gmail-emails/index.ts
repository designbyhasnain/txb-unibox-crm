import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow";
import { simpleParser } from "npm:mailparser";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getOAuthToken(supabase: any, account: any) {
  const now = new Date();
  const expiresAt = account.expires_at ? new Date(account.expires_at) : null;

  console.log(`[AUTH] Checking token for ${account.email_address}. Expires: ${expiresAt?.toISOString()}, Now: ${now.toISOString()}`);
  
  // If token is still valid (with 5 min buffer), return it
  if (account.access_token && expiresAt && (expiresAt.getTime() - now.getTime()) > 5 * 60 * 1000) {
    console.log(`[AUTH] Token still valid for ${account.email_address}`);
    return account.access_token;
  }

  if (!account.refresh_token) {
    console.error(`[AUTH_ERR] No refresh token found for ${account.email_address}`);
    throw new Error("AUTH_OAUTH_REFRESH_MISSING");
  }

  console.log(`[AUTH] Refreshing access token for ${account.email_address}...`);
  
  // Get Client ID and Secret from Env or Config
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    // Try app_config as fallback
    const { data: config } = await supabase.from("app_config").select("key, value");
    const id = config?.find((c: any) => c.key === "GOOGLE_CLIENT_ID")?.value;
    const secret = config?.find((c: any) => c.key === "GOOGLE_CLIENT_SECRET")?.value;
    
    if (!id || !secret) throw new Error("AUTH_CONFIG_MISSING");
    return refresh(id, secret, account.refresh_token, supabase, account.id);
  }

  return refresh(clientId, clientSecret, account.refresh_token, supabase, account.id);
}

async function refresh(clientId: string, clientSecret: string, refreshToken: string, supabase: any, accountId: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await response.json();
  if (!response.ok) {
    console.error(`[AUTH_ERR] Refresh failed for ${accountId}:`, tokens);
    throw new Error(`AUTH_REFRESH_FAILED: ${tokens.error_description || tokens.error || response.statusText}`);
  }

  // Update DB
  const expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await supabase
    .from("email_accounts")
    .update({ 
      access_token: tokens.access_token, 
      expires_at: expires_at 
    })
    .eq("id", accountId);

  return tokens.access_token;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { accountId } = await req.json();
    console.log(`[SYNC_START] Request for Account ID: ${accountId}`);
    if (!accountId) {
        throw new Error("MISSING_ACCOUNT_ID");
    }

    // 1. Get Account Details
    const { data: account, error: accError } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .single();

    if (accError || !account) {
        throw new Error("ACCOUNT_NOT_FOUND");
    }

    let authConfig: any = {};
    const isGmail = account.provider === "Gmail";

    if (isGmail && account.refresh_token) {
        console.log(`[AUTH] Using OAuth2 for Gmail: ${account.email_address}`);
        const accessToken = await getOAuthToken(supabase, account);
        authConfig = {
            user: account.email_address,
            accessToken: accessToken
        };
    } else {
        if (!account.imap_password) {
            throw new Error("AUTH_PASSWORD_MISSING");
        }
        console.log(`[AUTH] Using Password for: ${account.email_address}`);
        authConfig = {
            user: account.imap_username || account.email_address,
            pass: account.imap_password,
        };
    }

    const client = new ImapFlow({
      host: account.imap_host || (isGmail ? "imap.gmail.com" : ""),
      port: account.imap_port || 993,
      secure: true,
      auth: authConfig,
      logger: false,
    });

    try {
        await client.connect();
        console.log(`[CONN_SUCCESS] IMAP Connected for ${account.email_address}`);
    } catch (connErr: any) {
        console.error(`[ERR_CONN_FAILED] IMAP Connection Failed for ${account.email_address}:`, connErr);
        throw new Error(`CONN_FAILED: ${connErr.message}`);
    }
    
    // 2. Fetch INBOX
    let lock;
    try {
        lock = await client.getMailboxLock("INBOX");
    } catch (e) {
        throw new Error("MAILBOX_INBOX_LOCKED");
    }

    try {
      const totalMessages = client.mailbox.exists;
      const startRange = Math.max(1, totalMessages - 49);
      const range = `${startRange}:*`;
      
      console.log(`[SYNC_RANGE] Fetching INBOX range ${range}`);

      const messages = await client.fetch(range, {
        envelope: true,
        source: true,
        uid: true,
        // Gmail specific extensions
        ...(isGmail ? { "x-gm-thrid": true, "x-gm-labels": true } : {})
      });

      let count = 0;
      for await (let msg of messages) {
        count++;
        const parsed = await simpleParser(msg.source);
        const fromEmail = msg.envelope.from[0]?.address || "";
        const msgId = msg.envelope.messageId;
        const threadId = (msg as any).xGmThrid;
        const labels = (msg as any).xGmLabels; // Array of strings

        // Skip if sender is the account itself or missing info
        if (!fromEmail || fromEmail.toLowerCase() === account.email_address.toLowerCase()) continue;

        const { data: lead } = await supabase
          .from("leads")
          .select("id, campaign_id")
          .eq("email", fromEmail)
          .single();

        const { error: upsertErr } = await supabase.from("replies").upsert({
          user_id: account.user_id,
          email_account_id: account.id,
          lead_id: lead?.id,
          campaign_id: lead?.campaign_id,
          message_id: msgId,
          subject: msg.envelope.subject,
          body_text: parsed.text,
          body_html: parsed.html,
          snippet: parsed.text?.substring(0, 150),
          from_email: fromEmail,
          from_name: msg.envelope.from[0]?.name,
          to_email: account.email_address,
          received_at: msg.envelope.date,
          is_read: false,
          thread_id: threadId,
          labels: labels ? Array.from(labels) : null
        }, { onConflict: 'message_id' });

        if (upsertErr) console.error(`[ERR_DB_UPSERT_REPLY]`, upsertErr);
      }
      console.log(`[SYNC_COMPLETE_INBOX] Synced ${count} messages`);
    } finally {
      lock.release();
    }

    // 3. Fetch Sent Mail
    let sentMailbox = isGmail ? '[Gmail]/Sent Mail' : 'Sent';
    try {
        lock = await client.getMailboxLock(sentMailbox);
    } catch (e) {
        if (isGmail) {
            try { lock = await client.getMailboxLock('Sent'); sentMailbox = 'Sent'; } catch(e2) { sentMailbox = ''; }
        } else {
             sentMailbox = '';
        }
    }

    if (sentMailbox) {
        try {
          const totalSent = client.mailbox.exists;
          const startSentRange = Math.max(1, totalSent - 49);
          const sentRange = `${startSentRange}:*`;
          
          const sentMessages = await client.fetch(sentRange, {
            envelope: true,
            source: true,
            ...(isGmail ? { "x-gm-thrid": true, "x-gm-labels": true } : {})
          });

          let sentCount = 0;
          for await (let msg of sentMessages) {
            sentCount++;
            const toEmail = (msg.envelope.to && msg.envelope.to[0].address) || "";
            const msgId = msg.envelope.messageId;
            const threadId = (msg as any).xGmThrid;
            const labels = (msg as any).xGmLabels;

            if (!toEmail) continue;

            const { data: lead } = await supabase
              .from("leads")
              .select("id, campaign_id")
              .eq("email", toEmail)
              .limit(1)
              .maybeSingle();

            // Fetch step if it exists for campaign tracking
            let stepId = null;
            if (lead?.campaign_id) {
                const { data: step } = await supabase
                    .from("sequences")
                    .select("id")
                    .eq("campaign_id", lead.campaign_id)
                    .order("step_number", { ascending: true })
                    .limit(1)
                    .maybeSingle();
                stepId = step?.id;
            }

            // Always log sent mail (now nullable lead_id/campaign_id supported)
            await supabase.from("email_logs").upsert({
                user_id: account.user_id,
                email_account_id: account.id,
                lead_id: lead?.id || null,
                campaign_id: lead?.campaign_id || null,
                sequence_step_id: stepId,
                status: 'Sent',
                message_id: msgId,
                subject: msg.envelope.subject,
                sent_at: msg.envelope.date,
                thread_id: threadId,
                labels: labels ? Array.from(labels) : null
            }, { onConflict: 'message_id' });
          }
          console.log(`[SYNC_COMPLETE_SENT] Synced ${sentCount} sent messages`);
        } finally {
          lock.release();
        }
    }

    await client.logout();
    
    // Update synced status
    await supabase.from("email_accounts").update({
      last_synced_at: new Date().toISOString()
    }).eq("id", accountId as string);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`[SYNC_CRITICAL_FAILURE] ${err.message}`, err);
    const statusCode = (err.message.includes("AUTH_")) ? 400 : 500;
    
    return new Response(JSON.stringify({ 
        error: err.message,
        code: err.message.split(':')[0] 
    }), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
