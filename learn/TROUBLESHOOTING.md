# 🔧 Quick Troubleshooting Guide

## Common Cognito Setup Issues

### 1. "Invalid client_id" Error
**Cause:** Wrong Client ID in .env.local
**Fix:** Double-check your App Client ID matches exactly

### 2. "redirect_mismatch" Error  
**Cause:** Callback URL not configured in Cognito
**Fix:** Add `http://localhost:3000/callback` to App Client → Callback URL(s)

### 3. "Invalid scope" Error
**Cause:** Missing OAuth scopes
**Fix:** Enable these scopes in App Client → Allowed OAuth Scopes:
- ☑️ openid
- ☑️ email  
- ☑️ profile

### 4. "No client secret found"
**Cause:** App client doesn't have secret
**Fix:** Create new app client with "Generate client secret" enabled

### 5. "Domain not found" Error
**Cause:** No domain configured
**Fix:** Go to User Pool → App Integration → Domain → Create domain

## 🎯 Quick Checklist

Before testing, ensure:
- [ ] Client ID matches exactly
- [ ] Client Secret is copied correctly
- [ ] Domain prefix is set
- [ ] Callback URL: `http://localhost:3000/callback`
- [ ] Sign out URL: `http://localhost:3000`
- [ ] OAuth scopes: openid, email, profile

## 🆘 Still Having Issues?

1. **Check AWS Console:** Ensure all settings match your .env.local
2. **Restart dev server:** `npm run dev` after changes
3. **Clear browser cache:** Sometimes old tokens cause issues
4. **Check browser console:** Look for specific error messages
5. **Verify .env.local:** All values should match AWS exactly

## 📞 Need More Help?

- AWS Cognito Docs: https://docs.aws.amazon.com/cognito/latest/developerguide/
- OIDC Configuration: https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flow.html
- Domain Setup: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain.html