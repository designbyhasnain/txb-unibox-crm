import { requireAuth, signOut, getCurrentUser } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

/**
 * DashboardService — Data fetching layer
 */
class DashboardService {
  static async fetchStats() {
    console.log("📊 DashboardService: Fetching stats...");
    const [campaignsRes, leadsRes, sentRes, repliesRes] = await Promise.all([
      supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("status", "Running"),
      supabase.from("leads").select("id", { count: "exact", head: true }),
      supabase.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "Sent"),
      supabase.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "Replied"),
    ]);

    return {
      campaigns: campaignsRes.count || 0,
      leads: leadsRes.count || 0,
      sent: sentRes.count || 0,
      replies: repliesRes.count || 0,
    };
  }

  static async fetchRecentActivity() {
     // Mock or real activity fetch
     return [];
  }
}

/**
 * DashboardUI — Rendering layer
 */
class DashboardUI {
  constructor() {
    this.elements = {
      authLoading: document.getElementById("auth-loading"),
      appShell: document.getElementById("app-shell"),
      userName: document.getElementById("user-name"),
      userEmail: document.getElementById("user-email"),
      userAvatar: document.getElementById("user-avatar"),
      headerDate: document.getElementById("header-date"),
      stats: {
        campaigns: document.getElementById("stat-campaigns"),
        leads: document.getElementById("stat-leads"),
        sent: document.getElementById("stat-sent"),
        replies: document.getElementById("stat-replies")
      }
    };
  }

  showApp() {
    if (this.elements.authLoading) {
      this.elements.authLoading.hidden = true;
      this.elements.authLoading.style.display = "none";
    }
    if (this.elements.appShell) this.elements.appShell.hidden = false;
  }

  renderUserInfo(user) {
    if (!user) return;
    const name = user.user_metadata?.name || user.email.split("@")[0];
    const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
    
    if (this.elements.userName) this.elements.userName.textContent = name;
    if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
    if (this.elements.userAvatar) this.elements.userAvatar.textContent = initials;
  }

  renderDate() {
    if (this.elements.headerDate) {
      this.elements.headerDate.textContent = new Date().toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      });
    }
  }

  renderStats(stats) {
    Object.keys(stats).forEach(key => {
      if (this.elements.stats[key]) {
        this.animateCounter(this.elements.stats[key], stats[key]);
      }
    });
  }

  animateCounter(el, targetValue) {
    const duration = 1000;
    const start = performance.now();
    const startValue = parseInt(el.textContent) || 0;

    const update = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      el.textContent = Math.round(startValue + eased * (targetValue - startValue)).toLocaleString();

      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }
}

/**
 * Main Controller
 */
async function init() {
  const ui = new DashboardUI();
  
  try {
    const session = await requireAuth();
    if (!session) return;

    ui.showApp();
    ui.renderDate();

    const user = await getCurrentUser();
    ui.renderUserInfo(user);

    const stats = await DashboardService.fetchStats();
    ui.renderStats(stats);

  } catch (err) {
    console.error("Dashboard Init Error:", err);
    ui.showApp();
  }
}

// Global listeners
document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await signOut();
});

init();
