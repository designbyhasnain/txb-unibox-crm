#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TXB UniBox CRM — Admin User Creation Script                ║
 * ║                                                              ║
 * ║  Creates users via Supabase Auth Admin API.                  ║
 * ║  Only the admin (you) should run this script.                ║
 * ║                                                              ║
 * ║  Usage:                                                      ║
 * ║    node scripts/create-user.mjs                              ║
 * ║    node scripts/create-user.mjs --email x@y.com --name "X"   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "readline";
import { config } from "dotenv";
import { randomBytes } from "crypto";

// Load env vars from .env file
config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Validation ──────────────────────────────────────────────
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === "your_service_role_key_here") {
  console.error("\n❌ Missing configuration!\n");
  console.error("Please set the following in your .env file:");
  console.error("  VITE_SUPABASE_URL=https://your-project.supabase.co");
  console.error("  SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key\n");
  console.error("You can find the service_role key at:");
  console.error("  https://supabase.com/dashboard/project/jkmfyuduxhkkrdxcfhbn/settings/api\n");
  process.exit(1);
}

// ─── Create admin client (bypasses RLS) ──────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ─── Helpers ─────────────────────────────────────────────────
function generatePassword(length = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  const bytes = randomBytes(length);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Parse CLI args ──────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    const value = args[i + 1];
    if (key && value) parsed[key] = value;
  }
  return parsed;
}

// ─── Main ────────────────────────────────────────────────────
async function createUser() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   TXB UniBox CRM — Create User      ║");
  console.log("╚══════════════════════════════════════╝\n");

  const args = parseArgs();

  // Collect user info (from args or prompts)
  const name = args.name || (await prompt("👤 Full name: "));
  const email = args.email || (await prompt("📧 Email address: "));
  const password = args.password || generatePassword();
  const role = args.role || (await prompt("🔑 Role (admin/member) [member]: ")) || "member";

  if (!name || !email) {
    console.error("\n❌ Name and email are required.\n");
    process.exit(1);
  }

  console.log(`\n⏳ Creating user: ${name} <${email}>...`);

  // Step 1: Create the Auth user via Supabase Admin API
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm email (no verification needed)
    user_metadata: {
      name,
      role,
    },
  });

  if (authError) {
    console.error(`\n❌ Failed to create auth user: ${authError.message}\n`);
    process.exit(1);
  }

  console.log(`✅ Auth user created (ID: ${authUser.user.id})`);

  // Step 2: Insert into the public.users table
  const { error: profileError } = await supabase.from("users").insert({
    id: authUser.user.id, // Match Auth UID
    name,
    email,
    password: "hashed_by_supabase_auth", // Placeholder — actual hash is in auth.users
  });

  if (profileError) {
    console.error(`\n⚠️  Auth user created, but profile insert failed: ${profileError.message}`);
    console.error("   You may need to insert the profile row manually.\n");
  } else {
    console.log("✅ User profile created in public.users");
  }

  // Step 3: Print summary
  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│           🎉 User Created Successfully!     │");
  console.log("├─────────────────────────────────────────────┤");
  console.log(`│  Name:     ${name.padEnd(33)}│`);
  console.log(`│  Email:    ${email.padEnd(33)}│`);
  console.log(`│  Password: ${password.padEnd(33)}│`);
  console.log(`│  Role:     ${role.padEnd(33)}│`);
  console.log(`│  User ID:  ${authUser.user.id.substring(0, 33).padEnd(33)}│`);
  console.log("├─────────────────────────────────────────────┤");
  console.log("│  ⚠️  Share the password securely!           │");
  console.log("│  The user can change it after first login.  │");
  console.log("└─────────────────────────────────────────────┘\n");
}

// ─── Batch mode ──────────────────────────────────────────────
async function batchCreate() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   TXB UniBox CRM — Batch Create      ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Example batch — edit this array to add multiple users at once
  const users = [
    // { name: "John Doe", email: "john@example.com", role: "member" },
    // { name: "Jane Smith", email: "jane@example.com", role: "admin" },
  ];

  if (users.length === 0) {
    console.log("ℹ️  No users in batch list. Edit the `users` array in this script.");
    console.log("   Or use: node scripts/create-user.mjs --email user@email.com --name \"User\"\n");
    return;
  }

  for (const user of users) {
    const password = generatePassword();
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { name: user.name, role: user.role || "member" },
    });

    if (error) {
      console.error(`❌ ${user.email}: ${error.message}`);
      continue;
    }

    await supabase.from("users").insert({
      id: data.user.id,
      name: user.name,
      email: user.email,
      password: "hashed_by_supabase_auth",
    });

    console.log(`✅ ${user.name} <${user.email}> — Password: ${password}`);
  }

  console.log("\n🎉 Batch creation complete!\n");
}

// ─── Entry point ─────────────────────────────────────────────
const mode = process.argv.includes("--batch") ? "batch" : "single";
if (mode === "batch") {
  batchCreate().catch(console.error);
} else {
  createUser().catch(console.error);
}
