import { signIn, redirectIfAuthenticated } from "../lib/auth.js";

// ─── Redirect if already logged in ──────────────────────────
redirectIfAuthenticated();

// ─── DOM Elements ────────────────────────────────────────────
const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMessage = document.getElementById("error-message");
const loginBtn = document.getElementById("login-btn");
const btnText = loginBtn.querySelector(".btn-text");
const btnLoader = loginBtn.querySelector(".btn-loader");
const togglePasswordBtn = document.getElementById("toggle-password");

// ─── Toggle password visibility ─────────────────────────────
let passwordVisible = false;
togglePasswordBtn.addEventListener("click", () => {
  passwordVisible = !passwordVisible;
  passwordInput.type = passwordVisible ? "text" : "password";
  togglePasswordBtn.innerHTML = passwordVisible
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
         <line x1="1" y1="1" x2="23" y2="23"/>
       </svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
         <circle cx="12" cy="12" r="3"/>
       </svg>`;
});

// ─── Show/hide loading state ─────────────────────────────────
function setLoading(loading) {
  loginBtn.disabled = loading;
  btnText.hidden = loading;
  btnLoader.hidden = !loading;
  emailInput.disabled = loading;
  passwordInput.disabled = loading;
}

// ─── Show error message ──────────────────────────────────────
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add("visible");
  errorMessage.setAttribute("aria-live", "assertive");

  // Shake animation
  const formWrapper = document.querySelector(".form-wrapper");
  formWrapper.classList.add("shake");
  setTimeout(() => formWrapper.classList.remove("shake"), 500);
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.classList.remove("visible");
}

// ─── Form submission ─────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Please enter both email and password.");
    return;
  }

  setLoading(true);

  try {
    await signIn(email, password);
    // Success — redirect to dashboard
    window.location.href = "/";
  } catch (err) {
    const message =
      err.message === "Invalid login credentials"
        ? "Invalid email or password. Please try again."
        : err.message || "An unexpected error occurred.";
    showError(message);
  } finally {
    setLoading(false);
  }
});

// ─── Auto-focus email field ──────────────────────────────────
emailInput.focus();

// ─── Keyboard shortcuts ──────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement === emailInput) {
    passwordInput.focus();
  }
});
