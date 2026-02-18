import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Redirect URI must match Google Console exactly
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-auth-callback`;

const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

async function getClientId() {
  // Prefer Env Var
  const fromEnv = Deno.env.get("GOOGLE_CLIENT_ID");
  if (fromEnv) return fromEnv;

  console.log(`[Config] GOOGLE_CLIENT_ID not in env, checking app_config table...`);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", "GOOGLE_CLIENT_ID")
    .single();
  
  return data?.value || null;
}

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token");

    // Also support Bearer token from header
    const authHeader = req.headers.get("Authorization");
    if (!token && authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.replace("Bearer ", "");
    }

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const clientId = await getClientId();
    if (!clientId) {
        return new Response(JSON.stringify({ error: "GOOGLE_CLIENT_ID not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    // Build URL
    const state = btoa(JSON.stringify({ token, userId: user.id }));
    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", clientId);
    googleAuthUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", SCOPES);
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "consent");
    googleAuthUrl.searchParams.set("state", state);

    return Response.redirect(googleAuthUrl.toString(), 302);

  } catch (err: any) {
    console.error("[Fatal] Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
