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
      users: {
        Row: {
          id: string;
          email: string;
          name: string;
          is_teacher: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name: string;
          is_teacher?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string;
          is_teacher?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      user_class: {
        Row: {
          user_id: string;
          class_id: string;
          role: 'owner' | 'manager' | 'student';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          class_id: string;
          role?: 'owner' | 'manager' | 'student';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          class_id?: string;
          role?: 'owner' | 'manager' | 'student';
          created_at?: string;
          updated_at?: string;
        };
      };
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
      book_sections: {
        Row: {
          id: string;
          class_id: string;
          title: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          title: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          title?: string;
          position?: number;
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
          storage_path: string | null;
          duration: number | null;
          processing_status: 'pending' | 'processing' | 'completed' | 'failed';
          uploaded_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          title: string;
          video_url: string;
          storage_path?: string | null;
          duration?: number | null;
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
          uploaded_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          title?: string;
          video_url?: string;
          storage_path?: string | null;
          duration?: number | null;
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
          uploaded_at?: string;
          updated_at?: string;
        };
      };
      books: {
        Row: {
          id: string;
          class_id: string;
          section_id: string | null;
          title: string;
          pdf_url: string;
          file_size: number | null;
          processing_status: 'pending' | 'processing' | 'completed' | 'failed';
          error_message: string | null;
          storage_path: string | null;
          position: number;
          uploaded_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          section_id?: string | null;
          title: string;
          pdf_url: string;
          file_size?: number | null;
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
          error_message?: string | null;
          storage_path?: string | null;
          position?: number;
          uploaded_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          section_id?: string | null;
          title?: string;
          pdf_url?: string;
          file_size?: number | null;
          processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
          error_message?: string | null;
          storage_path?: string | null;
          position?: number;
          uploaded_at?: string;
          updated_at?: string;
        };
      };
      notes: {
        Row: {
          id: string;
          class_id: string;
          user_id: string;
          content: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          class_id: string;
          user_id: string;
          content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          class_id?: string;
          user_id?: string;
          content?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
