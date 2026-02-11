const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt } = require('../services/crypto.cjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const TARGET_TIMESTAMP = "2026-02-09T12:15:01.889+00:00";
const REDUCTION_AMOUNT = 100000;
const DRY_RUN = process.argv.includes('--dry-run');

async function correctPrices() {
    console.log(`--- DATABASE PRICE CORRECTION ---`);
    console.log(`Target: Orders delivered on or before ${TARGET_TIMESTAMP}`);
    console.log(`Action: Subtract ${REDUCTION_AMOUNT} from price (minimum 0)`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (No changes will be saved)' : 'LIVE UPDATE (Changes will be saved!)'}`);
    console.log(`---------------------------------\n`);

    // Fetch all affected orders
    const { data: orders, error } = await supabase
        .from('delivered')
        .select('*')
        .lte('delivered_at', TARGET_TIMESTAMP)
        .order('delivered_at', { ascending: false });

    if (error) {
        console.error("Error fetching orders:", error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log("No orders found to update.");
        return;
    }

    console.log(`Found ${orders.length} orders to process.\n`);

    let successCount = 0;
    let failCount = 0;

    for (const row of orders) {
        try {
            const originalData = decrypt(row.data_encrypted);
            const oldPrice = originalData.price || 0;
            const newPrice = Math.max(0, oldPrice - REDUCTION_AMOUNT);

            console.log(`Order ID: ${row.order_id} | Tracking: ${originalData.tracking_number} | Old Price: ${oldPrice} -> New Price: ${newPrice}`);

            if (!DRY_RUN) {
                const updatedData = { ...originalData, price: newPrice };
                const reEncrypted = encrypt(updatedData);

                const { error: updateErr } = await supabase
                    .from('delivered')
                    .update({ data_encrypted: reEncrypted })
                    .eq('order_id', row.order_id);

                if (updateErr) {
                    console.error(`  [X] Failed to update Order ID ${row.order_id}:`, updateErr.message);
                    failCount++;
                } else {
                    console.log(`  [V] Successfully updated.`);
                    successCount++;
                }
            } else {
                successCount++;
            }
        } catch (e) {
            console.error(`  [X] Error processing Order ID ${row.order_id}:`, e.message);
            failCount++;
        }
    }

    console.log(`\n---------------------------------`);
    console.log(`Process completed.`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    if (DRY_RUN) {
        console.log(`\nReminder: This was a DRY RUN. Run with 'node server/scripts/correct_prices.cjs' to apply changes.`);
    }
    console.log(`---------------------------------`);
}

correctPrices().catch(console.error);
