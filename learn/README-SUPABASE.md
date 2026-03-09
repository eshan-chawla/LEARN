# Supabase Database Setup for Learning Aid Platform

This guide will help you set up Supabase as the database for the Learning Aid platform.

## Prerequisites

- A Supabase account (sign up at https://supabase.com)
- Node.js and npm installed

## Setup Instructions

### 1. Create a Supabase Project

1. Go to https://supabase.com and sign in
2. Click "New Project"
3. Fill in the project details:
   - Project Name: Learning Aid (or your preferred name)
   - Database Password: Choose a strong password
   - Region: Select the closest region to your users
4. Click "Create new project" and wait for it to initialize

### 2. Set Up the Database Schema

1. In your Supabase project dashboard, go to the "SQL Editor"
2. Click "New Query"
3. Copy the contents of `supabase/schema.sql` from this project
4. Paste it into the SQL Editor
5. Click "Run" to execute the schema

This will create:
- `classes` table - stores class information
- `recordings` table - stores video recordings for classes
- `books` table - stores PDF books/notes
- `notes` table - stores text notes for each class
- Row Level Security (RLS) policies for data protection
- Indexes for better query performance
- Triggers for automatic timestamp updates

### 3. Configure Authentication

Since you're using AWS Cognito for authentication, you need to configure Supabase to work with JWT tokens from Cognito.

1. Go to your Supabase project settings
2. Navigate to "Authentication" > "Providers"
3. You'll need to configure custom JWT validation for Cognito tokens

**Note:** The RLS policies in the schema expect `auth.jwt() ->> 'sub'` to contain the user ID. Make sure your Cognito JWT tokens include the `sub` claim.

### 4. Get Your Supabase Credentials

1. In your Supabase project, go to "Settings" > "API"
2. Copy the following:
   - **Project URL** - This is your `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key - This is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 5. Update Environment Variables

1. Open your `.env.local` file
2. Add the Supabase credentials:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 6. Install Dependencies

The Supabase client library is already installed. If you need to reinstall:

```bash
npm install @supabase/supabase-js
```

## Database Schema Overview

### Classes Table
- Stores class information
- Each class belongs to a user (via `user_id`)
- Contains name, description, and timestamps

### Recordings Table
- Stores video recording URLs for classes
- Linked to classes via `class_id`
- Supports video URL storage and metadata

### Books Table
- Stores PDF book/document URLs
- Linked to classes via `class_id`
- Supports file metadata like size

### Notes Table
- Stores text notes for each class
- One note per class (enforced by UNIQUE constraint)
- Contains the note content and timestamps

## Security

### Row Level Security (RLS)

All tables have RLS enabled with policies that ensure:
- Users can only view, create, update, and delete their own data
- Data is automatically filtered by user_id
- Cross-user data access is prevented

### User Authentication

The system uses AWS Cognito for authentication. The `user_id` in the database is the `sub` claim from the Cognito JWT token.

## Usage in the Application

The dashboard page (`app/dashboard/page.tsx`) uses the Supabase client to:

1. **Load Classes**: Fetch all classes for the authenticated user
2. **Create Classes**: Insert new classes with user association
3. **Manage Recordings**: Add, view, and manage video recordings
4. **Manage Books**: Add, view, and manage PDF documents
5. **Manage Notes**: Create, update, and save text notes

All operations are automatically secured by RLS policies.

## File Storage (Optional Enhancement)

For production use, consider using Supabase Storage for uploading files:

1. Enable Supabase Storage in your project
2. Create storage buckets for videos and PDFs
3. Update the application to upload files to Supabase Storage
4. Store the generated URLs in the database

Example bucket setup:
- `class-videos` - for video recordings
- `class-books` - for PDF documents

## Troubleshooting

### Common Issues

1. **"Failed to create class"**
   - Check that your Supabase URL and anon key are correct
   - Verify that the schema was executed successfully
   - Check browser console for detailed error messages

2. **"Row Level Security policy violation"**
   - Ensure your Cognito JWT token includes the `sub` claim
   - Verify that the `user_id` matches the authenticated user's `sub`
   - Check RLS policies in the Supabase dashboard

3. **"Cannot connect to Supabase"**
   - Verify your internet connection
   - Check that the Supabase project is active
   - Ensure environment variables are loaded correctly

### Viewing Data

You can view and manage your data in the Supabase dashboard:
1. Go to "Table Editor"
2. Select a table to view its contents
3. You can manually add, edit, or delete records

### Testing RLS Policies

1. Go to "Authentication" > "Policies" in Supabase
2. You can test policies with different user contexts
3. Check the "SQL Editor" for query results

## Next Steps

Consider adding these enhancements:
- File upload functionality (direct to Supabase Storage)
- Real-time updates using Supabase realtime subscriptions
- Search functionality for classes and content
- Sharing classes with other users
- Class categories and tags
- Export functionality for notes

## Support

For Supabase-specific issues:
- Documentation: https://supabase.com/docs
- Community: https://github.com/supabase/supabase/discussions

For application issues:
- Check the browser console for errors
- Review the application logs
- Ensure all environment variables are set correctly
