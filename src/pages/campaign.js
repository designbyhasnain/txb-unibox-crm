import { requireAuth, logout } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

// DOM Elements
const authLoading = document.getElementById("auth-loading");
const appContent = document.getElementById("app-content");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");
const userEmail = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const campaignTitle = document.getElementById("campaign-title");
const campaignStatusBadge = document.getElementById("campaign-status-badge");
const toastContainer = document.getElementById("toast-container");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");

let campaignId = null;
let currentCampaign = null;

async function init() {
    const user = await requireAuth();
    if (user) {
        renderUserInfo(user);
        
        // Get Campaign ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        campaignId = urlParams.get("id");

        if (!campaignId) {
            window.location.href = "/campaigns.html";
            return;
        }

        authLoading.style.display = "none";
        appContent.style.display = "flex";
        
        loadCampaignDetails();
        initTabs();
    }
}

function renderUserInfo(user) {
    if (user.user_metadata?.name) {
      userName.textContent = user.user_metadata.name;
      userAvatar.textContent = user.user_metadata.name.charAt(0).toUpperCase();
    } else {
      userName.textContent = "User";
      userAvatar.textContent = "U";
    }
    userEmail.textContent = user.email;
}

async function loadCampaignDetails() {
    try {
        const { data, error } = await supabase
            .from("campaigns")
            .select("*")
            .eq("id", campaignId)
            .single();

        if (error) throw error;
        if (!data) throw new Error("Campaign not found");

        currentCampaign = data;
        renderCampaignHeader(data);

    } catch (err) {
        console.error("Error loading campaign:", err);
        showToast("Error loading campaign details", "error");
        setTimeout(() => window.location.href = "/campaigns.html", 2000);
    }
}

function renderCampaignHeader(campaign) {
    campaignTitle.textContent = campaign.name;
    campaignStatusBadge.textContent = campaign.status;
    campaignStatusBadge.className = `status-badge ${campaign.status.toLowerCase()}`;
    
    // Update daily limit in options tab if present
    const dailyLimitInput = document.getElementById("daily-limit");
    if(dailyLimitInput) dailyLimitInput.value = campaign.daily_limit || 50;
}

function initTabs() {
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabName = btn.dataset.tab;
            
            // Activate Tab Button
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Show Tab Pane
            tabPanes.forEach(pane => pane.classList.remove("active"));
            document.getElementById(`tab-${tabName}`).classList.add("active");
        });
    });
}

// Toast Notification (reused)
function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === "success" ? "✓" : "!"}</span>
      <span class="toast-message">${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
  
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
}

logoutBtn.addEventListener("click", logout);

init();
