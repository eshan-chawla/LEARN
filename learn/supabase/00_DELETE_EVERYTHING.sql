-- ⚠️ WARNING: This script will DELETE ALL DATA and TABLES ⚠️
-- Use this to start fresh with a clean database
-- Run this in Supabase SQL Editor

-- Drop tables first (CASCADE will automatically drop all triggers, constraints, policies, etc.)
-- Using IF EXISTS to avoid errors if tables don't exist

DROP TABLE IF EXISTS notes CASCADE;
DROP TABLE IF EXISTS books CASCADE;
DROP TABLE IF EXISTS recordings CASCADE;
DROP TABLE IF EXISTS classes CASCADE;

-- Drop functions (CASCADE will drop any remaining dependencies)
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Success message
SELECT 'All tables and functions have been deleted!' as status;
