import { supabase } from "./supabase.js";

/**
 * Auth Guard — Checks if user is logged in.
 * If not authenticated, redirects to /login.html
 * Call this at the top of every protected page.
 */
export async function requireAuth() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "/login.html";
    return null;
  }

  return session;
}

/**
 * Redirect Guard — If already logged in, redirect away from login page.
 * Call this on the login page to skip login if already authenticated.
 */
export async function redirectIfAuthenticated() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    window.location.href = "/";
    return session;
  }

  return null;
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

/**
 * Get current user info from session metadata.
 */
export async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Listen for auth state changes (login/logout).
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
