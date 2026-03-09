-- Add slug column to classes table
ALTER TABLE classes ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Create index on slug for faster lookups
CREATE INDEX IF NOT EXISTS idx_classes_slug ON classes(slug);

-- Function to generate slug from name
CREATE OR REPLACE FUNCTION generate_slug(name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Convert name to lowercase, replace spaces with hyphens, remove special chars
  base_slug := regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  final_slug := base_slug;

  -- Check if slug exists and add counter if needed
  WHILE EXISTS (SELECT 1 FROM classes WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

-- Update existing classes without slugs
UPDATE classes
SET slug = generate_slug(name || '-' || substring(id::text, 1, 8))
WHERE slug IS NULL;
