-- ⚠️ WARNING: This script will DELETE ALL DATA and TABLES ⚠️
-- Use this to start fresh with a clean database
-- Run this in Supabase SQL Editor

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
DROP TRIGGER IF EXISTS on_class_created_grant_owner_membership ON public.classes;

-- Drop tables first (CASCADE will automatically drop all triggers, constraints, policies, etc.)
-- Using IF EXISTS to avoid errors if tables don't exist

DROP TABLE IF EXISTS notes CASCADE;
DROP TABLE IF EXISTS books CASCADE;
DROP TABLE IF EXISTS recordings CASCADE;
DROP TABLE IF EXISTS user_class CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop functions (CASCADE will drop any remaining dependencies)
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS sync_auth_user_to_public_users() CASCADE;
DROP FUNCTION IF EXISTS can_view_class(UUID) CASCADE;
DROP FUNCTION IF EXISTS can_edit_class(UUID) CASCADE;
DROP FUNCTION IF EXISTS grant_class_owner_membership() CASCADE;
DROP FUNCTION IF EXISTS list_class_viewers(UUID) CASCADE;
DROP FUNCTION IF EXISTS add_user_to_class_by_email(UUID, TEXT, BOOLEAN) CASCADE;

-- Success message
SELECT 'All tables and functions have been deleted!' as status;
