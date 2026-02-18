
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// config
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-auth-callback`;

async function getConfig(key: string) {
  // Check Env First
  const fromEnv = Deno.env.get(key);
  if (fromEnv) return fromEnv;

  console.log(`[Config] ${key} not in env, checking app_config...`);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", key)
    .single();

  return data?.value || null;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const frontendUrl = (await getConfig("FRONTEND_URL")) || "http://localhost:3000";

  if (error) {
    console.error("Google Auth Error:", error);
    return Response.redirect(`${frontendUrl}/accounts.html?error=${error}`, 302);
  }

  if (!code || !state) {
    return Response.redirect(`${frontendUrl}/accounts.html?error=missing_code`, 302);
  }

  try {
    // Decode state
    const { token, userId } = JSON.parse(atob(state));

    const clientId = await getConfig("GOOGLE_CLIENT_ID");
    const clientSecret = await getConfig("GOOGLE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      throw new Error("Missing OAuth credentials");
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();
    console.log(`[AUTH_CALLBACK] Tokens received for code: ${code?.substring(0, 10)}...`);

    if (!tokenResponse.ok) {
        console.error(`[AUTH_CALLBACK_ERR] Token exchange failed:`, tokens);
        return Response.redirect(`${frontendUrl}/accounts.html?error=token_exchange_failed`, 302);
    }

    // Get User Profile from Google
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResponse.json();

    // Store in Supabase
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    console.log(`[DB] Saving tokens for ${profile.email}...`);
    
    // Check if email already exists
    const { data: existing } = await supabaseAdmin
        .from("email_accounts")
        .select("id")
        .eq("email_address", profile.email)
        .eq("user_id", userId)
        .maybeSingle();

    const payload: any = {
        access_token: tokens.access_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        status: 'Active'
    };

    // Google only sends refresh_token on the FIRST authorization
    if (tokens.refresh_token) {
        payload.refresh_token = tokens.refresh_token;
    }

    let dbResult;
    if (existing) {
        console.log(`[DB] Updating existing account: ${existing.id}`);
        dbResult = await supabaseAdmin
            .from("email_accounts")
            .update(payload)
            .eq("id", existing.id);
    } else {
        console.log(`[DB] Inserting new account for ${profile.email}`);
        dbResult = await supabaseAdmin
            .from("email_accounts")
            .insert({
                ...payload,
                user_id: userId,
                email_address: profile.email,
                display_name: profile.name || profile.email,
                provider: "Gmail",
                daily_limit: 50
            });
    }

    if (dbResult.error) {
        throw new Error(`Database write error: ${dbResult.error.message}`);
    }

    console.log("[Success] Gmail account connected and saved.");
    return Response.redirect(`${frontendUrl}/accounts.html?success=gmail`, 302);

  } catch (err: any) {
    console.error("Callback Error:", err);
    return Response.redirect(`${frontendUrl}/accounts.html?error=${encodeURIComponent(err.message)}`, 302);
  }
});
