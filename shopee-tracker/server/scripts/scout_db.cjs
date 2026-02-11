const { createClient } = require('@supabase/supabase-js');
const { decrypt } = require('../services/crypto.cjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function scout() {
    const targetTracking = "SPXVN066508744182";
    const targetTimestamp = "2026-02-09T12:15:01.889+00:00";

    console.log(`Checking orders older than or equal to ${targetTimestamp}...`);

    // Count in delivered table
    const { count, error } = await supabase
        .from('delivered')
        .select('*', { count: 'exact', head: true })
        .lte('delivered_at', targetTimestamp);

    if (error) {
        console.error("Count Error:", error);
    } else {
        console.log(`Total affected orders in 'delivered': ${count}`);
    }

    // Sample some prices
    const { data, error: fetchErr } = await supabase
        .from('delivered')
        .select('*')
        .lte('delivered_at', targetTimestamp)
        .order('delivered_at', { ascending: false })
        .limit(5);

    if (fetchErr) {
        console.error("Fetch Error:", fetchErr);
    } else {
        console.log("\nSample affected orders:");
        data.forEach(row => {
            try {
                const dec = decrypt(row.data_encrypted);
                console.log(`- Order ID: ${row.order_id}, Tracking: ${dec.tracking_number}, Price: ${dec.price}, Time: ${row.delivered_at}`);
            } catch (e) {
                console.log(`- Order ID: ${row.order_id} (Decrypt failed)`);
            }
        });
    }
}

scout().catch(console.error);
