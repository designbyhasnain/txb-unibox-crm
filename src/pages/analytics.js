import { requireAuth, signOut, getCurrentUser } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

class AnalyticsService {
  static async fetchDashboardData() {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    // Fetch KPI Data
    const [
      sentRes,
      openRes,
      clickRes,
      repliesRes,
      oppRes,
    ] = await Promise.all([
      // Total Sent
      supabase.from("email_logs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("sent_at", "is", null),
      // Opens
      supabase.from("email_logs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("opened_at", "is", null),
      // Clicks
      supabase.from("email_logs").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("clicked_at", "is", null),
      // Replies
      supabase.from("replies").select("thread_id")
        .eq("user_id", user.id),
      // Opportunities
      supabase.from("leads").select("id", { count: "exact", head: true })
        .in("status", ["Interested", "Meeting Booked", "Won"]) // Don't restrict to user_id just in case, or do we? Leads are tied to campaigns. But we can join campaigns or use the RPC. Wait, RLS handles it.
    ]);

    const totalSent = sentRes.count || 0;
    const totalOpens = openRes.count || 0;
    const totalClicks = clickRes.count || 0;

    // Unique threads in replies
    const uniqueThreads = new Set((repliesRes.data || []).map(r => r.thread_id).filter(id => id)).size;
    const totalOpportunities = oppRes.count || 0;

    const openRate = totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : 0;
    const clickRate = totalSent > 0 ? ((totalClicks / totalSent) * 100).toFixed(1) : 0;
    const replyRate = totalSent > 0 ? ((uniqueThreads / totalSent) * 100).toFixed(1) : 0;

    return {
      sent: totalSent,
      opens: totalOpens,
      openRate,
      clicks: totalClicks,
      clickRate,
      replies: uniqueThreads,
      replyRate,
      opportunities: totalOpportunities,
    };
  }

  static async fetchChartData() {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const isoDate = thirtyDaysAgo.toISOString();

    const [sentData, repliesData] = await Promise.all([
      supabase.from("email_logs").select("sent_at, opened_at, clicked_at").eq("user_id", user.id).gte("sent_at", isoDate),
      supabase.from("replies").select("received_at").eq("user_id", user.id).gte("received_at", isoDate)
    ]);

    // Aggregate by day
    const dates = {};
    for (let i = 0; i < 30; i++) {
        const d = new Date(thirtyDaysAgo);
        d.setDate(d.getDate() + i + 1);
        const dayStr = d.toISOString().split('T')[0];
        dates[dayStr] = { sent: 0, opens: 0, uniqueOpens: 0, replies: 0, clicks: 0, uniqueClicks: 0 };
    }

    (sentData.data || []).forEach(log => {
      if (!log.sent_at) return;
      const day = new Date(log.sent_at).toISOString().split('T')[0];
      if (dates[day]) {
         dates[day].sent++;
         if (log.opened_at) {
             dates[day].opens++;
             dates[day].uniqueOpens++;
         }
         if (log.clicked_at) {
             dates[day].clicks++;
             dates[day].uniqueClicks++;
         }
      }
    });

    (repliesData.data || []).forEach(log => {
      if (!log.received_at) return;
      const day = new Date(log.received_at).toISOString().split('T')[0];
      if (dates[day]) dates[day].replies++;
    });

    return {
      labels: Object.keys(dates).map(dateStr => new Date(dateStr).toLocaleDateString("en-US", { month: 'short', day: 'numeric' })),
      sent: Object.values(dates).map(d => d.sent),
      opens: Object.values(dates).map(d => d.opens),
      uniqueOpens: Object.values(dates).map(d => d.uniqueOpens),
      replies: Object.values(dates).map(d => d.replies),
      clicks: Object.values(dates).map(d => d.clicks),
      uniqueClicks: Object.values(dates).map(d => d.uniqueClicks)
    };
  }
}

class AnalyticsUI {
  constructor() {
    this.elements = {
      appShell: document.getElementById("app-shell"),
      authLoading: document.getElementById("auth-loading"),
      userName: document.getElementById("user-name"),
      userEmail: document.getElementById("user-email"),
      userAvatar: document.getElementById("user-avatar"),
      kpiSent: document.getElementById("kpi-sent"),
      kpiOpen: document.getElementById("kpi-open"),
      kpiClick: document.getElementById("kpi-click"),
      kpiReply: document.getElementById("kpi-reply"),
      kpiOpportunities: document.getElementById("kpi-opportunities"),
    };
    this.chart = null;
  }

  showApp() {
    if (this.elements.authLoading) this.elements.authLoading.style.display = "none";
    if (this.elements.appShell) this.elements.appShell.hidden = false;
  }

  renderUserInfo(user) {
    if (!user) return;
    const name = user.user_metadata?.name || user.email.split("@")[0];
    const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().substring(0, 2);

    if (this.elements.userName) this.elements.userName.textContent = name;
    if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
    if (this.elements.userAvatar) this.elements.userAvatar.textContent = initials;
  }

  updateDashboard(data) {
    this.animateValue(this.elements.kpiSent, this.parseNumber(this.elements.kpiSent), data.sent, "");
    this.animateValue(this.elements.kpiOpen, this.parseFloatNumber(this.elements.kpiOpen), data.openRate, "");
    this.animateValue(this.elements.kpiClick, this.parseFloatNumber(this.elements.kpiClick), data.clickRate, "");
    this.animateValue(this.elements.kpiReply, this.parseFloatNumber(this.elements.kpiReply), data.replyRate, "");
    this.animateValue(this.elements.kpiOpportunities, this.parseNumber(this.elements.kpiOpportunities), data.opportunities, "");
  }

  parseNumber(el) {
    if (!el) return 0;
    return parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
  }

  parseFloatNumber(el) {
    if (!el) return 0.0;
    return parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0.0;
  }

  animateValue(el, start, end, suffix, duration = 1000) {
    if (!el) return;
    const startTime = performance.now();
    const isFloat = !Number.isInteger(parseFloat(end)) || suffix === "%";

    const update = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // Ease out
      
      let current = start + (parseFloat(end) - start) * eased;
      if (isFloat) {
        el.textContent = current.toFixed(1) + suffix;
      } else {
        el.textContent = Math.round(current).toLocaleString() + suffix;
      }

      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  renderChart(chartData) {
    const ctx = document.getElementById("analyticsChart");
    if (!ctx) return;

    if (this.chart) {
      if (this.chart.data.datasets.length !== 6) {
        this.chart.destroy();
        this.chart = null;
      } else {
        this.chart.data.labels = chartData.labels;
        this.chart.data.datasets[0].data = chartData.sent;
        this.chart.data.datasets[1].data = chartData.opens;
        this.chart.data.datasets[2].data = chartData.uniqueOpens;
        this.chart.data.datasets[3].data = chartData.replies;
        this.chart.data.datasets[4].data = chartData.clicks;
        this.chart.data.datasets[5].data = chartData.uniqueClicks;
        this.chart.update();
        return;
      }
    }

    this.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: chartData.labels,
        datasets: [
          {
             label: "Sent",
             data: chartData.sent,
             borderColor: '#3b82f6',
             backgroundColor: '#3b82f6',
             fill: false,
             tension: 0,
             borderWidth: 2,
             pointRadius: 0,
             pointHoverRadius: 4
          },
          {
             label: "Total opens",
             data: chartData.opens,
             borderColor: '#eab308',
             backgroundColor: '#eab308',
             fill: false,
             tension: 0,
             borderWidth: 2,
             pointRadius: 0,
             pointHoverRadius: 4
          },
          {
             label: "Unique opens",
             data: chartData.uniqueOpens,
             borderColor: '#a3e635',
             backgroundColor: '#a3e635',
             fill: false,
             tension: 0,
             borderWidth: 2,
             pointRadius: 0,
             pointHoverRadius: 4
          },
          {
             label: "Total replies",
             data: chartData.replies,
             borderColor: '#2dd4bf',
             backgroundColor: '#2dd4bf',
             fill: false,
             tension: 0,
             borderWidth: 2,
             pointRadius: 0,
             pointHoverRadius: 4
          },
          {
            label: "Total clicks",
            data: chartData.clicks,
            borderColor: '#6b7280',
            backgroundColor: '#6b7280',
            fill: false,
            tension: 0,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: "Unique clicks",
            data: chartData.uniqueClicks,
            borderColor: '#4b5563',
            backgroundColor: '#4b5563',
            fill: false,
            tension: 0,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              color: "#475569", // Light mode legible grey
              font: {
                family: "Inter, sans-serif",
                size: 11
              },
            },
            padding: 20
          },
          tooltip: {
            mode: "index",
            intersect: false,
            titleFont: { family: "Inter, sans-serif" },
            bodyFont: { family: "Inter, sans-serif" },
            padding: 12,
            backgroundColor: "rgba(255, 255, 255, 0.9)", // Light background
            titleColor: "#0f172a", // Dark title for light tooltip
            bodyColor: "#334155", // Dark body for light tooltip
            borderColor: "#e2e8f0",
            borderWidth: 1
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              font: { family: "Inter, sans-serif", size: 10 },
              color: "#64748b"
            },
          },
          y: {
            grid: {
              color: "#e2e8f0", // Light subtle grey grid
            },
            ticks: {
              font: { family: "Inter, sans-serif", size: 10 },
              color: "#64748b",
              precision: 0,
            },
            border: {
              display: false
            }
          },
        },
        interaction: {
          mode: "nearest",
          axis: "x",
          intersect: false,
        },
      },
    });
  }
}

async function subscribeToRealtimeUpdates(ui) {
    const user = await getCurrentUser();
    if (!user) return;

    const handleUpdate = async () => {
        console.log("Real-time update triggered. Refreshing analytics...");
        const data = await AnalyticsService.fetchDashboardData();
        ui.updateDashboard(data);
        const chartData = await AnalyticsService.fetchChartData();
        ui.renderChart(chartData);
    };

    const channel = supabase.channel('analytics_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_logs', filter: `user_id=eq.${user.id}` }, handleUpdate)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'email_logs', filter: `user_id=eq.${user.id}` }, handleUpdate)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'replies', filter: `user_id=eq.${user.id}` }, handleUpdate)
      .subscribe();
      
    return channel;
}

async function init() {
  const ui = new AnalyticsUI();

  try {
    const session = await requireAuth();
    if (!session) return;
    ui.showApp();

    const user = await getCurrentUser();
    ui.renderUserInfo(user);

    // Initial fetch
    const [dashboardData, chartData] = await Promise.all([
      AnalyticsService.fetchDashboardData(),
      AnalyticsService.fetchChartData()
    ]);

    ui.updateDashboard(dashboardData);
    ui.renderChart(chartData);
    
    // Real-time listener
    await subscribeToRealtimeUpdates(ui);

  } catch (error) {
    console.error("Error initializing analytics:", error);
    ui.showApp(); // ensure UI shows even if data fetch fails
  }
}

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await signOut();
});

document.addEventListener("DOMContentLoaded", init);
