const { createClient } = require('@supabase/supabase-js');
const { decrypt } = require('../services/crypto.cjs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkRaw() {
    const targetOrderId = "224127963227887";
    const { data, error } = await supabase
        .from('delivered')
        .select('*')
        .eq('order_id', targetOrderId)
        .single();

    if (error) {
        console.error("Error:", error);
        return;
    }

    const dec = decrypt(data.data_encrypted);
    console.log("Raw Decrypted Data for target order:");
    console.log(JSON.stringify(dec, null, 2));
}

checkRaw().catch(console.error);
