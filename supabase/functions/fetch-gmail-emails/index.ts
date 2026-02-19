import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow";
import { simpleParser } from "npm:mailparser";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // SECURITY: Get User from JWT (SEC-01)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
        console.error("[AUTH_ERR] User verification failed:", authError);
        throw new Error("UNAUTHORIZED");
    }

    const { accountId, limit = 10 } = await req.json();
    console.log(`[SYNC_START] User: ${user.id}, Account: ${accountId}, Limit: ${limit}`);
    
    if (!accountId) {
        throw new Error("MISSING_ACCOUNT_ID");
    }

    // 1. Get Account (LOG-01 ownership check)
    const { data: account, error: accError } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .single();

    if (accError || !account) {
        throw new Error("ACCOUNT_NOT_FOUND_OR_FORBIDDEN");
    }

    let authConfig: any = {};
    const isGmail = account.provider === "Gmail";

    if (isGmail && account.refresh_token) {
        console.log(`[AUTH] OAuth2 Refresh for ${account.email_address}`);
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
    
    const syncStats = {
      inboxProcessed: 0,
      sentProcessed: 0,
      errors: [] as string[]
    };

    try {
      // 2. Fetch INBOX
      let lock;
      try {
          lock = await client.getMailboxLock("INBOX");
      } catch (e) {
          throw new Error("MAILBOX_INBOX_LOCKED");
      }

      try {
        const totalMessages = client.mailbox.exists;
        const fetchCount = Math.min(limit, 10); 
        const startRange = Math.max(1, totalMessages - fetchCount + 1);
        const range = `${startRange}:*`;
        
        console.log(`[SYNC_RANGE] Fetching INBOX envelopes for range ${range}`);

        const msgList = await client.fetch(range, {
          envelope: true,
          uid: true,
          ...(isGmail ? { "x-gm-thrid": true, "x-gm-labels": true } : {})
        });

        const upsertBatch = [];

        for await (let msg of msgList) {
          try {
            const fromEmail = msg.envelope.from[0]?.address || "";
            if (!fromEmail || fromEmail.toLowerCase() === account.email_address.toLowerCase()) continue;

            // RE-FETCH individual source with size check if possible, or just tight try-catch
            console.log(`[SYNC_INBOX] Fetching UID ${msg.uid} (${fromEmail})`);
            
            let sourceData = "";
            try {
                const sourceFetch = await client.fetch(msg.uid.toString(), { source: true }, { uid: true });
                for await (let s of sourceFetch) {
                    sourceData = s.source.toString();
                }
            } catch (fetchErr) {
                console.warn(`[SYNC_WARN] Failed to fetch source for UID ${msg.uid}:`, fetchErr);
                continue;
            }

            if (!sourceData) continue;

            // Step 1: Resilient Parsing
            let parsed;
            try {
                parsed = await simpleParser(sourceData);
            } catch (parseErr) {
                console.error(`[SYNC_PARSE_ERR] Failed to parse UID ${msg.uid}. Skipping heavy email.`);
                continue;
            }

            const msgId = msg.envelope.messageId;
            const threadId = (msg as any).xGmThrid;
            const labels = (msg as any).xGmLabels;

            const { data: lead } = await supabase
              .from("leads")
              .select("id, campaign_id")
              .eq("email", fromEmail)
              .eq("user_id", user.id)
              .maybeSingle();

            upsertBatch.push({
              user_id: account.user_id,
              email_account_id: account.id,
              lead_id: lead?.id || null,
              campaign_id: lead?.campaign_id || null,
              message_id: msgId,
              subject: msg.envelope.subject,
              body_text: parsed.text || parsed.textAsHtml || "",
              body_html: parsed.html || parsed.textAsHtml || "",
              snippet: (parsed.text || "").substring(0, 160),
              from_email: fromEmail,
              from_name: msg.envelope.from[0]?.name || fromEmail.split('@')[0],
              to_email: account.email_address,
              received_at: msg.envelope.date || new Date().toISOString(),
              is_read: false,
              thread_id: threadId,
              labels: labels ? Array.from(labels) : null
            });

            syncStats.inboxProcessed++;

            // Step 1: Batch of 5
            if (upsertBatch.length >= 5) {
                await supabase.from("replies").upsert(upsertBatch, { onConflict: 'message_id' });
                upsertBatch.length = 0;
            }
          } catch (msgErr: any) {
            console.error(`[SYNC_MSG_ERR] Msg processing failed:`, msgErr.message);
            syncStats.errors.push(msgErr.message);
            continue; 
          }
        }

        if (upsertBatch.length > 0) {
            await supabase.from("replies").upsert(upsertBatch, { onConflict: 'message_id' });
        }
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
            const fetchCountSent = Math.min(limit, 50);
            const startSentRange = Math.max(1, totalSent - fetchCountSent + 1);
            const sentRange = `${startSentRange}:*`;
            
            console.log(`[SYNC_SENT] Fetching Sent range ${sentRange}`);
            
            const sentMsgList = await client.fetch(sentRange, {
              envelope: true,
              uid: true,
              ...(isGmail ? { "x-gm-thrid": true, "x-gm-labels": true } : {})
            });

            const sentBatch = [];

            for await (let msg of sentMsgList) {
              try {
                const toEmail = (msg.envelope.to && msg.envelope.to[0].address) || "";
                if (!toEmail) continue;

                const msgId = msg.envelope.messageId;
                const threadId = (msg as any).xGmThrid;
                const labels = (msg as any).xGmLabels;

                const { data: lead } = await supabase
                  .from("leads")
                  .select("id, campaign_id")
                  .eq("email", toEmail)
                  .eq("user_id", user.id)
                  .limit(1)
                  .maybeSingle();

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

                sentBatch.push({
                    user_id: account.user_id,
                    email_account_id: account.id,
                    lead_id: lead?.id || null,
                    campaign_id: lead?.campaign_id || null,
                    sequence_step_id: stepId,
                    status: 'Sent',
                    message_id: msgId,
                    to_email: toEmail,
                    subject: msg.envelope.subject,
                    sent_at: msg.envelope.date,
                    thread_id: threadId,
                    labels: labels ? Array.from(labels) : null
                });

                syncStats.sentProcessed++;

                if (sentBatch.length >= 5) {
                   await supabase.from("email_logs").upsert(sentBatch, { onConflict: 'message_id' });
                   sentBatch.length = 0;
                }
              } catch (sentErr: any) {
                 console.error("[SYNC_SENT_MSG_ERR]", sentErr.message);
                 syncStats.errors.push(sentErr.message);
              }
            }
            
            if (sentBatch.length > 0) {
                await supabase.from("email_logs").upsert(sentBatch, { onConflict: 'message_id' });
            }
          } finally {
            lock.release();
          }
      }

      await client.logout();
      
      // Update synced status
      await supabase.from("email_accounts").update({
        last_synced_at: new Date().toISOString()
      }).eq("id", accountId as string);

      return new Response(JSON.stringify({ 
          success: true, 
          inbox: syncStats.inboxProcessed, 
          sent: syncStats.sentProcessed 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error(`[SYNC_PARTIAL_FAILURE] ${err.message}`);
      
      // If we processed anything, return 200 with partialSuccess: true
      if (syncStats.inboxProcessed > 0 || syncStats.sentProcessed > 0) {
          return new Response(JSON.stringify({ 
              success: true, 
              partial: true, 
              inbox: syncStats.inboxProcessed, 
              sent: syncStats.sentProcessed,
              error: err.message 
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
      }

      const statusCode = (err.message.includes("AUTH_")) ? 400 : 500;
      return new Response(JSON.stringify({ 
          error: err.message,
          code: err.message.split(':')[0] 
      }), {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (outerErr: any) {
    console.error(`[SYNC_CRITICAL_ERR]`, outerErr);
    return new Response(JSON.stringify({ error: outerErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
