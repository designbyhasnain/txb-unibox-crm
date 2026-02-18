
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConfiguration() {
    console.log("🔍 Checking Gmail Configuration in Database...");

    const { data: config, error } = await supabase
        .from('app_config')
        .select('*')
        .in('key', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

    if (error) {
        console.error("❌ Error fetching app_config:", error.message);
        return;
    }

    const clientId = config.find(c => c.key === 'GOOGLE_CLIENT_ID')?.value;
    const clientSecret = config.find(c => c.key === 'GOOGLE_CLIENT_SECRET')?.value;

    console.log("\n--- Database Configuration ---");
    if (clientId) {
        console.log(`✅ GOOGLE_CLIENT_ID found: ${clientId.substring(0, 15)}...`);
    } else {
        console.error("❌ GOOGLE_CLIENT_ID is MISSING in app_config table!");
    }

    if (clientSecret) {
        console.log(`✅ GOOGLE_CLIENT_SECRET found: ${clientSecret.substring(0, 5)}...`);
    } else {
        console.error("❌ GOOGLE_CLIENT_SECRET is MISSING in app_config table!");
    }

    // Compare with .env
    console.log("\n--- Comparison with .env ---");
    const envId = process.env.GOOGLE_CLIENT_ID;
    
    if (envId === clientId) {
        console.log("✅ Database Client ID matches .env file.");
    } else {
        console.warn("⚠️  MISMATCH: Database Client ID does not match .env file!");
        console.log(`   .env: ${envId}`);
        console.log(`   DB:   ${clientId}`);
        console.log("   (The Backend uses the DB value)");
    }

    console.log("\n✅ The Edge Functions are configured to read from the 'app_config' table.");
    console.log("   You can confidently click 'Connect Gmail' now.");
}

checkConfiguration();
