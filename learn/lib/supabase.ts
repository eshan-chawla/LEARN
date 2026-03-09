import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Default client without auth
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Create a Supabase client with custom JWT token (for custom auth integration)
export function createSupabaseClient(accessToken?: string): SupabaseClient {
  if (!accessToken) {
    return supabase;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

// Database types
export interface Database {
  public: {
    Tables: {
      classes: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          slug: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          slug?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          slug?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      recordings: {
        Row: {
          id: string;
          class_id: string;
          title: string;
          video_url: string;
          duration: number | null;
          uploaded_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          title: string;
          video_url: string;
          duration?: number | null;
          uploaded_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          title?: string;
          video_url?: string;
          duration?: number | null;
          uploaded_at?: string;
          updated_at?: string;
        };
      };
      books: {
        Row: {
          id: string;
          class_id: string;
          title: string;
          pdf_url: string;
          file_size: number | null;
          uploaded_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          title: string;
          pdf_url: string;
          file_size?: number | null;
          uploaded_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          title?: string;
          pdf_url?: string;
          file_size?: number | null;
          uploaded_at?: string;
          updated_at?: string;
        };
      };
      notes: {
        Row: {
          id: string;
          class_id: string;
          content: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
