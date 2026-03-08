# AWS Cognito Setup Guide - Finding Your Credentials

## 🎯 Quick Reference for Your Current Setup

**Your User Pool ARN:** `arn:aws:cognito-idp:us-east-1:767398053131:userpool/us-east-1_eWZ2JyG1X`

**Already Configured:**
- ✅ Region: `us-east-1`
- ✅ User Pool ID: `us-east-1_eWZ2JyG1X`
- ✅ Client ID: `79l5orkf9h9hnofv1usg8c4ut8`

**Still Need:**
- ⏳ Client Secret
- ⏳ Domain Prefix

## 📍 Step-by-Step Visual Guide

### 1. **Finding Client Secret**

```
AWS Console Journey:
┌─────────────────────────────────────────────────────────────┐
│ 1. Sign in to AWS Console                                  │
│ 2. Search "Cognito" in top search bar                      │
│ 3. Click "Amazon Cognito"                                  │
│ 4. Click "User Pools" (left sidebar)                       │
│ 5. Find: us-east-1_eWZ2JyG1X → Click it                    │
│ 6. Left sidebar → "App integration"                        │
│ 7. Click "App clients"                                     │
│ 8. Find: 79l5orkf9h9hnofv1usg8c4ut8 → Click it             │
│ 9. Look for "App client secret" → Click "Show"              │
│ 10. Copy the secret value                                   │
└─────────────────────────────────────────────────────────────┘
```

### 2. **Finding Domain Prefix**

```
From the same User Pool page:
┌─────────────────────────────────────────────────────────────┐
│ 1. Left sidebar → "App integration"                        │
│ 2. Click "Domain"                                          │
│ 3. You'll see: "Domain name"                                │
│ 4. It looks like: your-domain-prefix.auth.us-east-1.amazoncognito.com │
│ 5. Copy ONLY the prefix part (before .auth...)             │
│ 6. Example: if you see "myapp.auth.us-east-1..." → copy "myapp" │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Common Issues & Solutions

### Issue: "Can't find App clients"
**Solution:** Make sure you're in the correct User Pool. Look for `us-east-1_eWZ2JyG1X` in the User Pool list.

### Issue: "No client secret showing"
**Solution:** Some app clients don't have secrets. If yours doesn't, you can:
1. Create a new app client with "Generate client secret" enabled
2. Or use the existing one without secret (some flows don't require it)

### Issue: "No domain configured"
**Solution:** You need to create a domain:
1. Go to "Domain" in the left sidebar
2. Click "Create domain"
3. Enter a unique prefix (like your app name)
4. Save it

## 📝 Update Your .env.local

Once you find the values, update these lines:

```bash
# Replace these placeholders:
COGNITO_CLIENT_SECRET=your-actual-client-secret-here
NEXT_PUBLIC_COGNITO_DOMAIN=your-actual-domain-prefix-here

# Example (don't use these exact values):
# COGNITO_CLIENT_SECRET=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
# NEXT_PUBLIC_COGNITO_DOMAIN=myapp-auth
```

## 🚀 Final Steps

1. **Get Client Secret** from App clients → Show client secret
2. **Get Domain Prefix** from Domain settings
3. **Update .env.local** with both values
4. **Restart your dev server** (`npm run dev`)
5. **Test authentication** at http://localhost:3000

Need help? Check the AWS Cognito documentation or let me know!