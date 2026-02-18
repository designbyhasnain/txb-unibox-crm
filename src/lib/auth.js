import { supabase } from "./supabase.js";

/**
 * Auth Guard — Checks if user is logged in.
 */
export async function requireAuth() {
  console.log("🕵️ Checking authentication...");
  
  // 1. Check for tokens in the URL fragment (Magic Link / OAuth responses)
  const isRedirect = window.location.hash.includes("access_token=") || 
                    window.location.hash.includes("error=");
  
  if (isRedirect) {
    console.log("📍 Redirect fragment detected, waiting for Supabase to process...");
    // Give Supabase a bit to process the hash
    await new Promise(r => setTimeout(r, 500));
  }

  // 2. Check current session
  let { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error("❌ Auth Session Error:", error);
  }

  // 3. Fallback: Wait for INITIAL_SESSION event
  if (!session) {
    console.log("⏳ No session found in local cache, checking with Supabase server...");
    
    session = await new Promise((resolve) => {
      let subscription = null;
      
      const timeout = setTimeout(() => {
        if (subscription) subscription.unsubscribe();
        resolve(null);
      }, 3000);

      const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
        console.log(`⚡ Auth Event: ${event}`);
        if (newSession || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
          clearTimeout(timeout);
          if (data?.subscription) data.subscription.unsubscribe();
          resolve(newSession);
        }
      });
      
      subscription = data?.subscription;
    });
  }

  if (!session) {
    console.warn("🚫 Not authenticated. Redirecting to login...");
    const currentPath = window.location.pathname;
    if (currentPath !== "/login.html") {
      window.location.href = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
    }
    return null;
  }

  console.log("✅ Authenticated as:", session.user.email);
  return session;
}

/**
 * Sign in with email and password.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

/**
 * Sign out and redirect to login.
 */
export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "/login.html";
}

// Alias for compatibility
export { signOut as logout };

/**
 * Get current user.
 */
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.warn("⚠️ getUser() failed, trying session user...", error.message);
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user || null;
  }
  return user;
}

/**
 * Listen for auth state changes.
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

/**
 * Redirect if already logged in (for login page).
 */
export async function redirectIfAuthenticated() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") || "/";
    window.location.href = redirect;
    return session;
  }
  return null;
}
