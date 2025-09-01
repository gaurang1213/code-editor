# Environment Setup Guide

## Quick Setup for Development

1. **Create a `.env.local` file** in the root directory with the following content:

```env
# Database (optional for development - will use mock database if not set)
# DATABASE_URL="mongodb://localhost:27017/vibecode-playground"

# NextAuth Configuration (required)
AUTH_SECRET="your-super-secret-auth-key-change-this-in-production"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-super-secret-auth-key-change-this-in-production"

# OAuth Providers (optional for now)
# AUTH_GOOGLE_ID=""
# AUTH_GOOGLE_SECRET=""
# AUTH_GITHUB_ID=""
# AUTH_GITHUB_SECRET=""
```

2. **For now, you can leave the OAuth providers empty** - the app will work with mock authentication

3. **The mock database is now set up** - you don't need MongoDB for development

## What's Fixed

✅ **Starter Templates**: All framework templates are now available
✅ **Mock Database**: No more database connection errors
✅ **Template Loading**: The 500 error should be resolved
✅ **React 19 Compatibility**: Dependencies updated

## Testing the Playground

1. Start the development server: `npm run dev`
2. Navigate to a playground (e.g., `/playground/mock-playground-1`)
3. The template should now load without the 500 error

## Next Steps

- The playground should now work with mock data
- You can create real playgrounds and they'll be stored in memory
- When you're ready for production, set up MongoDB and configure OAuth providers
