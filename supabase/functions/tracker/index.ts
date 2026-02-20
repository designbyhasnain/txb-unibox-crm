import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// 1x1 transparent PNG image
const TRANSPARENT_PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type');
    const logId = url.searchParams.get('logId');

    if (!logId) {
      return new Response('Missing logId', { status: 400 });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (type === 'open') {
      // Update opened_at if null
      await supabaseClient
        .from('email_logs')
        .update({ opened_at: new Date().toISOString() })
        .eq('id', logId)
        .is('opened_at', null);

      return new Response(TRANSPARENT_PIXEL, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }

    if (type === 'click') {
      const redirectUrl = url.searchParams.get('url');
      if (!redirectUrl) {
        return new Response('Missing target URL', { status: 400 });
      }

      // Update clicked_at if null
      await supabaseClient
        .from('email_logs')
        .update({ clicked_at: new Date().toISOString() })
        .eq('id', logId)
        .is('clicked_at', null);

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          'Location': redirectUrl
        }
      });
    }

    return new Response('Invalid type', { status: 400 });

  } catch (error) {
    console.error('Tracker error:', error);
    return new Response('Internal error', { status: 500 });
  }
});
