import { requireAuth, signOut } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

// DOM Elements
const authLoading = document.getElementById("auth-loading");
const appShell = document.getElementById("app-shell");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");
const userEmail = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const campaignTitle = document.getElementById("campaign-title");
const campaignStatusBadge = document.getElementById("campaign-status-badge");
const toastContainer = document.getElementById("toast-container");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");

// Leads Elements
const leadsTableContainer = document.getElementById("leads-table-container");
const leadsList = document.getElementById("leads-list");
const leadsEmpty = document.getElementById("leads-empty");
const leadsLoading = document.getElementById("leads-loading");
const leadsCountBadge = document.getElementById("leads-count");

// Import Modal Elements
const importBtn = document.getElementById("import-leads-btn");
const importLink = document.getElementById("import-leads-link");
const importModal = document.getElementById("import-modal");
const closeModalButtons = document.querySelectorAll(".close-modal, .close-modal-btn");
const uploadArea = document.getElementById("upload-area");
const fileInput = document.getElementById("csv-file-input");
const importStep1 = document.getElementById("import-step-1");
const importStep2 = document.getElementById("import-step-2");
const mappingGrid = document.getElementById("mapping-grid");
const startImportBtn = document.getElementById("start-import-btn");
const totalRowsCount = document.getElementById("total-rows-count");

let campaignId = null;
let currentCampaign = null;
let parsedCSVData = [];
let csvHeaders = [];
let columnMapping = {}; // csvHeader -> dbField

const DB_FIELDS = [
    { key: "email", label: "Email Address", required: true },
    { key: "first_name", label: "First Name", required: false },
    { key: "last_name", label: "Last Name", required: false },
    { key: "company", label: "Company", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "website", label: "Website", required: false },
    { key: "custom_variables", label: "Custom Variables", required: false },
];

async function init() {
  try {
    const user = await requireAuth();
    if (user) {
      renderUserInfo(user);
      
      const urlParams = new URLSearchParams(window.location.search);
      campaignId = urlParams.get("id");

      if (!campaignId) {
        window.location.href = "/campaigns.html";
        return;
      }

      if (authLoading) authLoading.hidden = true;
      if (appShell) appShell.hidden = false;
      
      loadCampaignDetails();
      initTabs();
      initImportModal();
      loadLeads();
    }
  } catch (err) {
    console.error("Campaign Details Init Error:", err);
    if (authLoading) authLoading.hidden = true;
    if (appShell) appShell.hidden = false;
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

// ─── Campaign Data ──────────────────────────────────────────────
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
    
    if(document.getElementById("daily-limit")) 
        document.getElementById("daily-limit").value = campaign.daily_limit || 50;
}

// ─── Leads Logic ──────────────────────────────────────────────
async function loadLeads() {
    try {
        leadsLoading.style.display = "flex";
        leadsEmpty.style.display = "none";
        leadsTableContainer.style.display = "none";

        const { data: leads, error, count } = await supabase
            .from("leads")
            .select("*", { count: 'exact' })
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        leadsCountBadge.textContent = count || 0;

        if (!leads || leads.length === 0) {
            leadsEmpty.style.display = "flex";
        } else {
            renderLeads(leads);
            leadsTableContainer.style.display = "block";
        }

    } catch (err) {
        console.error("Error loading leads:", err);
        showToast("Failed to load leads", "error");
    } finally {
        leadsLoading.style.display = "none";
    }
}

function renderLeads(leads) {
    leadsList.innerHTML = "";
    leads.forEach(lead => {
        const tr = document.createElement("tr");
        
        const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—";
        const company = lead.company || "—";
        const statusClass = lead.status.toLowerCase().replace(" ", "-");

        tr.innerHTML = `
            <td>${lead.email}</td>
            <td>${name}</td>
            <td>${company}</td>
            <td><span class="status-dot ${statusClass}"></span> ${lead.status}</td>
            <td>${new Date(lead.created_at).toLocaleDateString()}</td>
        `;
        leadsList.appendChild(tr);
    });
}

// ─── Import Logic ──────────────────────────────────────────────
function initImportModal() {
    // Open/Close logic
    [importBtn, importLink].forEach(btn => {
        if(btn) btn.addEventListener("click", () => {
            importModal.classList.add("active");
            resetImportModal();
        });
    });

    closeModalButtons.forEach(btn => {
        btn.addEventListener("click", () => importModal.classList.remove("active"));
    });

    importModal.addEventListener("click", (e) => {
        if (e.target === importModal) importModal.classList.remove("active");
    });

    // File Upload logic
    uploadArea.addEventListener("click", () => fileInput.click());
    uploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadArea.classList.add("highlight");
    });
    uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("highlight"));
    uploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadArea.classList.remove("highlight");
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    startImportBtn.addEventListener("click", executeImport);
}

function resetImportModal() {
    parsedCSVData = [];
    csvHeaders = [];
    columnMapping = {};
    fileInput.value = "";
    importStep1.style.display = "block";
    importStep2.style.display = "none";
    startImportBtn.disabled = true;
    startImportBtn.textContent = "Import Leads";
}

function handleFile(file) {
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
        showToast("Please upload a CSV file.", "error");
        return;
    }

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            if (results.data && results.data.length > 0) {
                parsedCSVData = results.data;
                csvHeaders = results.meta.fields;
                totalRowsCount.textContent = results.data.length;
                showMappingStep();
            } else {
                showToast("CSV file appears to be empty.", "error");
            }
        },
        error: function(err) {
            console.error(err);
            showToast("Error parsing CSV.", "error");
        }
    });
}

function showMappingStep() {
    importStep1.style.display = "none";
    importStep2.style.display = "block";
    startImportBtn.disabled = false;
    
    mappingGrid.innerHTML = "";
    columnMapping = {};

    // For each DB field, create a row to select CSV column
    DB_FIELDS.forEach(field => {
        // Skip custom variables for simple mapping for now
        if (field.key === "custom_variables") return;

        const row = document.createElement("div");
        row.className = "mapping-row";
        
        // Try to auto-detect
        const detectedHeader = csvHeaders.find(h => 
            h.toLowerCase().includes(field.key) || 
            (field.key === "email" && h.toLowerCase().includes("mail")) ||
            (field.key === "first_name" && (h.toLowerCase().includes("first") || h.toLowerCase() === "name"))
        );

        if (detectedHeader) {
            columnMapping[field.key] = detectedHeader;
        }

        row.innerHTML = `
            <div class="field-label">${field.label} ${field.required ? "*" : ""}</div>
            <div class="field-arrow">→</div>
            <div class="field-select">
                <select class="map-select" data-key="${field.key}">
                    <option value="">-- Ignore --</option>
                    ${csvHeaders.map(h => `<option value="${h}" ${h === detectedHeader ? "selected" : ""}>${h}</option>`).join("")}
                </select>
            </div>
        `;
        mappingGrid.appendChild(row);
    });

    // Listen for changes
    document.querySelectorAll(".map-select").forEach(select => {
        select.addEventListener("change", (e) => {
            const key = e.target.dataset.key;
            if (e.target.value) {
                columnMapping[key] = e.target.value;
            } else {
                delete columnMapping[key];
            }
        });
    });
}

async function executeImport() {
    if (!columnMapping["email"]) {
        showToast("Access Email mapping is required.", "error");
        return;
    }

    startImportBtn.disabled = true;
    startImportBtn.textContent = "Importing...";

    try {
        const formattedLeads = parsedCSVData.map(row => {
            const lead = {
                campaign_id: campaignId,
                email: row[columnMapping["email"]], // Required
                status: "Not Contacted"
            };

            // Map optional fields
            if (columnMapping["first_name"]) lead.first_name = row[columnMapping["first_name"]];
            if (columnMapping["last_name"]) lead.last_name = row[columnMapping["last_name"]];
            if (columnMapping["company"]) lead.company = row[columnMapping["company"]];
            if (columnMapping["phone"]) lead.phone = row[columnMapping["phone"]];
            if (columnMapping["website"]) lead.website = row[columnMapping["website"]];
            
            // Clean up empty strings
            Object.keys(lead).forEach(k => {
                if(lead[k] === "") lead[k] = null;
            });
            
            return lead;
        }).filter(l => l.email && l.email.includes("@")); // Basic validation

        if (formattedLeads.length === 0) {
            throw new Error("No valid leads found (missing emails).");
        }

        // Insert into Supabase (Upsert to ignore existence errors or fail gracefully?)
        // Schema has UNIQUE(campaign_id, email). 'ignoreDuplicates' is safer.
        const { data, error } = await supabase
            .from("leads")
            .upsert(formattedLeads, { onConflict: "campaign_id, email", ignoreDuplicates: true });

        if (error) throw error;

        showToast(`Successfully processed ${formattedLeads.length} leads.`, "success");
        importModal.classList.remove("active");
        
        // Reload leads
        loadLeads();

    } catch (err) {
        console.error("Import error:", err);
        showToast("Import failed: " + err.message, "error");
    } finally {
        startImportBtn.disabled = false;
        startImportBtn.textContent = "Import Leads";
    }
}

// ─── Tabs ──────────────────────────────────────────────
function initTabs() {
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabName = btn.dataset.tab;
            
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            tabPanes.forEach(pane => pane.classList.remove("active"));
            document.getElementById(`tab-${tabName}`).classList.add("active");
        });
    });
}


// Reused Toasts
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

logoutBtn.addEventListener("click", signOut);

init();
