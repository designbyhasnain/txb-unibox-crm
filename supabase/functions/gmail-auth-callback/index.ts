import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-auth-callback`;

// The frontend URL to redirect back to after OAuth
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    // Handle Google errors (user denied access etc.)
    if (errorParam) {
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent(errorParam)}`,
        302
      );
    }

    if (!code || !stateParam) {
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("Missing authorization code.")}`,
        302
      );
    }

    // Decode state to get user info
    let state: { token: string; userId: string };
    try {
      state = JSON.parse(atob(stateParam));
    } catch {
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("Invalid state parameter.")}`,
        302
      );
    }

    // Verify the user's JWT is still valid
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(state.token);

    if (authError || !user) {
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("Session expired. Please log in again.")}`,
        302
      );
    }

    // ─── Exchange authorization code for tokens ───────────
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Token exchange error:", tokenData);
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("Failed to exchange authorization code.")}`,
        302
      );
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // ─── Get the Gmail user info ──────────────────────────
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const userInfo = await userInfoRes.json();
    const gmailAddress = userInfo.email;
    const displayName = userInfo.name || gmailAddress.split("@")[0];

    if (!gmailAddress) {
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("Could not retrieve Gmail address.")}`,
        302
      );
    }

    // ─── Check for duplicate email ────────────────────────
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await supabaseAdmin
      .from("email_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("email_address", gmailAddress)
      .maybeSingle();

    if (existing) {
      // Update tokens for existing account
      await supabaseAdmin
        .from("email_accounts")
        .update({
          oauth_access_token: access_token,
          oauth_refresh_token: refresh_token,
          status: "Active",
          display_name: displayName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?success=gmail`,
        302
      );
    }

    // ─── Insert new email account ─────────────────────────
    const { error: insertError } = await supabaseAdmin
      .from("email_accounts")
      .insert({
        user_id: user.id,
        email_address: gmailAddress,
        display_name: displayName,
        provider: "Gmail",
        oauth_access_token: access_token,
        oauth_refresh_token: refresh_token,
        smtp_host: "smtp.gmail.com",
        smtp_port: 465,
        imap_host: "imap.gmail.com",
        imap_port: 993,
        status: "Active",
        daily_limit: 50,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return Response.redirect(
        `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("Failed to save account: " + insertError.message)}`,
        302
      );
    }

    return Response.redirect(
      `${FRONTEND_URL}/accounts.html?success=gmail`,
      302
    );
  } catch (err) {
    console.error("gmail-auth-callback error:", err);
    return Response.redirect(
      `${FRONTEND_URL}/accounts.html?error=${encodeURIComponent("An unexpected error occurred.")}`,
      302
    );
  }
});
