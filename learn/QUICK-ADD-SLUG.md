# Quick Fix: Add Slug Column

## The Error
You're seeing "Error loading class" because the `slug` column doesn't exist in your database yet.

## Quick Solution

Run this SQL in your Supabase SQL Editor:

### Step 1: Add the slug column

```sql
-- Add slug column to classes table
ALTER TABLE classes ADD COLUMN slug TEXT;

-- Create index on slug for faster lookups
CREATE INDEX idx_classes_slug ON classes(slug);
```

### Step 2: (Optional) Generate slugs for existing classes

If you already have classes in your database, run this to generate slugs for them:

```sql
-- Generate slugs for existing classes
UPDATE classes
SET slug = lower(
  regexp_replace(
    regexp_replace(name, '[^a-zA-Z0-9 ]', '', 'g'),
    ' +', '-', 'g'
  )
) || '-' || substring(id::text, 1, 8)
WHERE slug IS NULL;
```

## How to Run This:

1. Go to https://supabase.com
2. Open your project
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy and paste the SQL above
6. Click **Run**
7. Refresh your app

## After Running

Your app should now work perfectly! You'll be able to:
- Create new classes (they'll get slugs automatically)
- View classes by their slug URLs
- Old classes will work with ID-based URLs as fallback

The code now handles both slug and ID-based lookups, so it's backward compatible!
