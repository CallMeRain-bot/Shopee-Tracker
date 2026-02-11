/**
 * Supabase Client for Frontend
 * Handles authentication and real-time subscriptions
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration - từ VPS .env
const SUPABASE_URL = 'https://ripwdnrzknhltpkzewke.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpcHdkbnJ6a25obHRwa3pld2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNjU4NzUsImV4cCI6MjA4MDg0MTg3NX0.MOQqLG1-gl4PnPvv8TH4CGamYb9q-Nhvl_9jufpYobQ';

// Create Supabase client với secure options
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,      // Tự động refresh token
        persistSession: true,         // Lưu session vào localStorage
        detectSessionInUrl: true,     // Detect OAuth redirects
        storage: window.localStorage, // Storage cho session
    },
});

/**
 * Get current user session
 * @returns {Promise<Session|null>}
 */
export const getSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Error getting session:', error);
        return null;
    }
    return session;
};

/**
 * Get current user
 * @returns {Promise<User|null>}
 */
export const getUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
        console.error('Error getting user:', error);
        return null;
    }
    return user;
};

/**
 * Sign in with email and password
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{user, session, error}>}
 */
export const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });
    return { user: data?.user, session: data?.session, error };
};

/**
 * Sign out current user
 * @returns {Promise<{error}>}
 */
export const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
};

/**
 * Get access token for API calls
 * @returns {Promise<string|null>}
 */
export const getAccessToken = async () => {
    const session = await getSession();
    return session?.access_token || null;
};
