import { requireAuth, signOut, getCurrentUser } from "../lib/auth.js";

// ─── Auth Gate: redirect to login if not authenticated ───────
async function initApp() {
  const session = await requireAuth();
  if (!session) return; // Will redirect to /login.html

  // Hide loading, show app
  document.getElementById("auth-loading").hidden = true;
  document.getElementById("app-shell").hidden = false;

  // Load user info
  const user = await getCurrentUser();
  if (user) {
    const name = user.user_metadata?.name || user.email.split("@")[0];
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);

    document.getElementById("user-name").textContent = name;
    document.getElementById("user-email").textContent = user.email;
    document.getElementById("user-avatar").textContent = initials;
  }

  // Set current date
  document.getElementById("header-date").textContent = new Date().toLocaleDateString(
    "en-US",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" }
  );

  // Load dashboard stats
  loadDashboardStats();
}

// ─── Load dashboard stats ────────────────────────────────────
async function loadDashboardStats() {
  try {
    const { supabase } = await import("../lib/supabase.js");

    // Fetch counts in parallel
    const [campaignsRes, leadsRes, sentRes, repliesRes] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "Running"),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("email_logs")
        .select("id", { count: "exact", head: true })
        .eq("status", "Sent"),
      supabase
        .from("email_logs")
        .select("id", { count: "exact", head: true })
        .eq("status", "Replied"),
    ]);

    animateCounter("stat-campaigns", campaignsRes.count || 0);
    animateCounter("stat-leads", leadsRes.count || 0);
    animateCounter("stat-sent", sentRes.count || 0);
    animateCounter("stat-replies", repliesRes.count || 0);
  } catch (err) {
    console.warn("Could not load dashboard stats:", err);
  }
}

// ─── Animate counter ─────────────────────────────────────────
function animateCounter(elementId, targetValue) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const duration = 800;
  const start = performance.now();

  function update(current) {
    const elapsed = current - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(eased * targetValue).toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// ─── Logout ──────────────────────────────────────────────────
document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut();
});

// ─── Initialize ──────────────────────────────────────────────
initApp();
