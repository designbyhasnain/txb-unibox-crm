import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Always handle CORS preflight first — before any logic that could crash
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // SECURITY: Get User from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error('[AUTH_ERR]', authError);
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { accountId, to, subject, htmlBody, threadId, originalMessageId, leadId } = body;

    const logId = crypto.randomUUID();
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const trackerUrl = `${supabaseUrl}/functions/v1/tracker`;
    
    let finalHtml = htmlBody || '';
    if (supabaseUrl && finalHtml) {
      // Inject open tracking pixel
      const openPixel = `<img src="${trackerUrl}?type=open&logId=${logId}" width="1" height="1" style="display:none;" />`;
      
      // Wrap links for click tracking
      finalHtml = finalHtml.replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1([^>]*)>/gi, (match, quote, url, rest) => {
        // Skip mailto:, tel:, or if already a tracking URL
        if (!url || url.startsWith('mailto:') || url.startsWith('tel:') || url.includes('tracker?type=')) {
          return match;
        }
        const trackingUrl = `${trackerUrl}?type=click&logId=${logId}&url=${encodeURIComponent(url)}`;
        // We match `href=...` and replace just the URL part
        return match.replace(`href=${quote}${url}${quote}`, `href=${quote}${trackingUrl}${quote}`);
      });

      finalHtml = finalHtml + openPixel;
    }

    console.log('BACKEND RECEIVED:', { accountId, to, subject, htmlBodyLength: htmlBody?.length, threadId, leadId, logId });

    if (!accountId || !to || !htmlBody) {
      return new Response(JSON.stringify({ error: `Missing required fields. Got: accountId=${accountId}, to=${to}, htmlBody=${!!htmlBody}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Get Sender Account Credentials
    const { data: account, error: accountError } = await supabaseClient
      .from('email_accounts')
      .select('refresh_token, email_address, user_id')
      .eq('id', accountId)
      .eq('user_id', user.id)
      .single();

    if (accountError || !account) {
      console.error('[ACCOUNT_ERR]', accountError);
      return new Response(JSON.stringify({ error: 'Email account not found or access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Refresh Google Access Token
    const tokenParams = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[TOKEN_ERR] Refresh failed:', tokenData);
      return new Response(JSON.stringify({ error: 'Failed to refresh access token', detail: tokenData }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Construct RFC 2822 Raw Email
    const strSubject = subject && subject.startsWith('Re:') ? subject : `Re: ${subject || '(no subject)'}`;
    const references = originalMessageId || '';

    const rawLines = [
      `From: ${account.email_address}`,
      `To: ${to}`,
      `Subject: ${strSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
    ];
    if (originalMessageId) {
      rawLines.push(`In-Reply-To: ${originalMessageId}`);
      rawLines.push(`References: ${references}`);
    }
    rawLines.push('');
    rawLines.push(finalHtml);

    const messageParts = rawLines.join('\r\n');
    const encodedMessage = btoa(unescape(encodeURIComponent(messageParts)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 4. Send via Gmail API with thread fallback
    const sendEmail = async (tId: string | null) => {
      const requestBody: Record<string, string> = { raw: encodedMessage };
      if (tId) requestBody.threadId = tId;
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      return res.json();
    };

    let sendData = await sendEmail(threadId || null);
    if (sendData.error?.message?.includes('Invalid thread_id')) {
      console.warn('[RETRY] Bad threadId, retrying without it...');
      sendData = await sendEmail(null);
    }

    if (sendData.error) {
      console.error('[GMAIL_ERR]', sendData.error);
      return new Response(JSON.stringify({ error: sendData.error.message || 'Gmail send failed', gmailError: sendData.error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[GMAIL_OK] Sent message:', sendData.id, 'thread:', sendData.threadId);

    // 5. Save to replies table (AWAITED — not fire-and-forget)
    const plainText = htmlBody.replace(/<[^>]*>?/gm, '');
    const { error: replyInsertError } = await supabaseClient.from('replies').insert({
      user_id: user.id,
      lead_id: leadId || null,
      email_account_id: accountId,
      thread_id: sendData.threadId,
      message_id: sendData.id,
      from_email: account.email_address,
      from_name: 'Me',
      to_email: to,
      subject: strSubject,
      snippet: plainText.substring(0, 100),
      body_text: plainText,
      body_html: htmlBody,
      received_at: new Date().toISOString(),
      is_read: true,
      type: 'sent',
    });

    if (replyInsertError) {
      console.error('[REPLY_INSERT_ERR]', replyInsertError);
      // Don't fail the whole request — email was sent. Log and continue.
    } else {
      console.log('[REPLY_INSERT_OK] Saved to replies table for realtime broadcast');
    }

    // 6. Save to email_logs for audit trail (AWAITED)
    const { error: logInsertError } = await supabaseClient.from('email_logs').insert({
      id: logId,
      user_id: user.id,
      email_account_id: accountId,
      thread_id: sendData.threadId,
      message_id: sendData.id,
      from_email: account.email_address,
      to_email: to,
      subject: strSubject,
      body_text: plainText,
      body_html: finalHtml,
      sent_at: new Date().toISOString(),
      status: 'Sent',
    });

    if (logInsertError) {
      console.error('[LOG_INSERT_ERR]', logInsertError);
    }

    return new Response(JSON.stringify({ 
      success: true,
      id: sendData.id, 
      threadId: sendData.threadId 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    // Outermost catch — always return CORS headers so browser sees the error
    console.error('[CRITICAL_ERR]', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
