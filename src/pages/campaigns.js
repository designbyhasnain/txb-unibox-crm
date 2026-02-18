import { requireAuth, logout } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

// DOM Elements
const authLoading = document.getElementById("auth-loading");
const appContent = document.getElementById("app-content");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");
const userEmail = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const campaignsList = document.getElementById("campaigns-list");
const loadingIndicator = document.getElementById("campaigns-loading");
const emptyState = document.getElementById("campaigns-empty");
const tableContainer = document.getElementById("campaigns-table-container");
const newCampaignBtn = document.getElementById("new-campaign-btn");
const emptyCreateBtn = document.getElementById("empty-create-btn");
const createModal = document.getElementById("create-modal");
const createForm = document.getElementById("create-campaign-form");
const closeModalButtons = document.querySelectorAll(".close-modal, .close-modal-btn");
const toastContainer = document.getElementById("toast-container");

let currentUser = null;

// Initialize
async function init() {
  const user = await requireAuth();
  if (user) {
    currentUser = user;
    renderUserInfo(user);
    authLoading.style.display = "none";
    appContent.style.display = "flex";
    loadCampaigns();
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

async function loadCampaigns() {
  try {
    loadingIndicator.style.display = "flex";
    emptyState.style.display = "none";
    tableContainer.style.display = "none";

    // Fetch campaigns
    const { data: campaigns, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!campaigns || campaigns.length === 0) {
      emptyState.style.display = "flex";
    } else {
      renderCampaigns(campaigns);
      tableContainer.style.display = "block";
    }
  } catch (err) {
    console.error("Error loading campaigns:", err);
    showToast("Failed to load campaigns", "error");
  } finally {
    loadingIndicator.style.display = "none";
  }
}

function renderCampaigns(campaigns) {
  campaignsList.innerHTML = "";
  
  campaigns.forEach((campaign) => {
    const tr = document.createElement("tr");
    tr.className = "campaign-row";
    tr.onclick = (e) => {
        // Don't navigate if clicking actions or similar (future proofing)
        window.location.href = `/campaign.html?id=${campaign.id}`;
    };

    const statusClass = campaign.status.toLowerCase();
    
    // Placeholder logic for stats since we don't have leads/logs aggregation yet
    // In a real app, these would come from joined views or separate counters
    const sent = 0; 
    const replied = 0;
    const progress = 0;
    
    tr.innerHTML = `
      <td>
        <div class="campaign-name-cell">
          <span class="campaign-name">${campaign.name}</span>
        </div>
      </td>
      <td>
        <span class="status-badge ${statusClass}">${campaign.status}</span>
      </td>
      <td>
        <div class="progress-bar-container">
           <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
        <span class="progress-text">${progress}% complete</span>
      </td>
      <td>${sent}</td>
      <td>${replied}</td>
      <td>${new Date(campaign.created_at).toLocaleDateString()}</td>
    `;
    campaignsList.appendChild(tr);
  });
}

// Modal Handling
function openModal() {
  createModal.classList.add("active");
  document.getElementById("campaign-name").focus();
}

function closeModal() {
  createModal.classList.remove("active");
  createForm.reset();
}

// Create Campaign
async function handleCreate(e) {
  e.preventDefault();
  const nameInput = document.getElementById("campaign-name");
  const name = nameInput.value.trim();

  if (!name) return;

  const btn = createForm.querySelector(".submit-btn");
  const originalText = btn.textContent;
  btn.textContent = "Creating...";
  btn.disabled = true;

  try {
    const { data, error } = await supabase
      .from("campaigns")
      .insert([
        { 
          user_id: currentUser.id,
          name: name,
          status: 'Draft',
          daily_limit: 50 // default
        }
      ])
      .select()
      .single();

    if (error) throw error;

    showToast("Campaign created successfully", "success");
    closeModal();
    // Redirect to campaign details
    setTimeout(() => {
        window.location.href = `/campaign.html?id=${data.id}`;
    }, 500);

  } catch (err) {
    console.error("Error creating campaign:", err);
    showToast("Failed to create campaign", "error");
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Toast Notification
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === "success" ? "✓" : "!"}</span>
    <span class="toast-message">${message}</span>
  `;
  
  toastContainer.appendChild(toast);
  
  // Trigger animation
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

// Event Listeners
logoutBtn.addEventListener("click", logout);
newCampaignBtn.addEventListener("click", openModal);
emptyCreateBtn.addEventListener("click", openModal);
createForm.addEventListener("submit", handleCreate);

closeModalButtons.forEach(btn => {
  btn.addEventListener("click", closeModal);
});

createModal.addEventListener("click", (e) => {
  if (e.target === createModal) closeModal();
});

// Run
init();
