
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { accountId, to, subject, htmlBody, threadId, originalMessageId } = await req.json();

    if (!accountId || !htmlBody) {
      throw new Error('Missing required fields');
    }

    // 1. Get Sender Account Credentials
    const { data: account, error: accountError } = await supabaseClient
      .from('email_accounts')
      .select('refresh_token, email_address')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Email account not found');
    }

    // 2. Refresh Access Token
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
      console.error('Token refresh failed:', tokenData);
      throw new Error('Failed to refresh access token');
    }

    // 3. Construct Raw Email (RFC 2822)
    const boundary = "boundary_string_123";
    const references = originalMessageId ? `${originalMessageId}` : ''; 
    // Ideally we would fetch the full references chain from the original email, 
    // but plugging the original ID into References and In-Reply-To is the minimal requirement for threading.

    const strSubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    // Note: We need to be careful with formatting to ensure headers are valid.
    const messageParts = [
      `From: ${account.email_address}`,
      `To: ${to}`,
      `Subject: ${strSubject}`,
      originalMessageId ? `In-Reply-To: ${originalMessageId}` : '',
      originalMessageId ? `References: ${references}` : '',
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      ``,
      htmlBody
    ].filter(line => line !== '').join('\r\n');

    // Base64URL encode
    const encodedMessage = btoa(unescape(encodeURIComponent(messageParts)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 4. Send via Gmail API
    const sendRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: encodedMessage,
          threadId: threadId // Attempt to thread securely
        }),
      }
    );

    const sendData = await sendRes.json();
    
    if (sendData.error) {
       console.error('Gmail API Error:', sendData);
       throw new Error(sendData.error.message || 'Gmail API send failed');
    }

    // 5. Log to email_logs (Optional but recommended for syncing sent items locally)
    await supabaseClient.from('email_logs').insert({
        account_id: accountId,
        thread_id: threadId,
        message_id: sendData.id, // The new message ID
        from_email: account.email_address,
        to_email: to,
        subject: strSubject,
        body_text: htmlBody.replace(/<[^>]*>?/gm, ''), // Simple text fallback
        body_html: htmlBody,
        sent_at: new Date().toISOString(),
        status: 'sent',
        provider_message_id: sendData.id
    });

    return new Response(JSON.stringify(sendData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
