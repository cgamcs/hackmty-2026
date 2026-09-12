import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null in demo mode (no Supabase env configured). */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
