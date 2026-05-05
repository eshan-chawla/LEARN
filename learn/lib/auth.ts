import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';
import { getErrorMessage, isInvalidRefreshTokenError } from './supabaseAuth';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

async function clearLocalSession() {
  await supabase.auth.signOut({ scope: 'local' });
}

export async function signUp(email: string, password: string, name?: string) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    return { data: null, error: getErrorMessage(error) || 'Sign up failed' };
  }
}

export async function signIn(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    return { data: null, error: getErrorMessage(error) || 'Sign in failed' };
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();

    if (error && isInvalidRefreshTokenError(error)) {
      await clearLocalSession();
      return { error: null };
    }

    if (error) throw error;

    return { error: null };
  } catch (error) {
    return { error: getErrorMessage(error) || 'Sign out failed' };
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearLocalSession();
      }

      return null;
    }

    return user;
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearLocalSession();
    }

    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await clearLocalSession();
      }

      return null;
    }

    return session;
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearLocalSession();
    }

    return null;
  }
}

export function onAuthStateChange(callback: (user: User | null) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });

  return subscription;
}
