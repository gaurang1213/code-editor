import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"

import authConfig from "./auth.config"
import { db } from "./lib/db";
import { getAccountByUserId, getUserById } from "@/features/auth/actions";

 

 
const hasPrisma = typeof (db as any)?.$transaction === 'function'

export const { auth, handlers, signIn, signOut } = NextAuth({
  callbacks: {
    /**
     * Handle user creation and account linking after a successful sign-in
     */
    async signIn({ user, account, profile }) {
      if (!user || !account) return false;

      // Check if the user already exists
      const existingUser = await db.user.findUnique({
        where: { email: user.email! },
      });

      // If user does not exist, create a new one (when using Prisma). If running with mock DB, skip.
      if (!existingUser) {
        const userDelegate: any = (db as any)?.user;
        if (userDelegate?.create) {
          const newUser = await userDelegate.create({
            data: {
              email: user.email!,
              name: user.name,
              image: user.image,
              accounts: {
                create: {
                  type: account.type,
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                  refreshToken: (account as any).refresh_token,
                  accessToken: (account as any).access_token,
                  expiresAt: (account as any).expires_at,
                  tokenType: (account as any).token_type,
                  scope: (account as any).scope,
                  idToken: (account as any).id_token,
                  sessionState: (account as any).session_state,
                },
              },
            },
          });
          if (!newUser) return false; // In case adapter create fails
        }
        // When on mock DB, there is no persistent write; allow sign-in to proceed
      } else {
        // Link the account if user exists (only when Prisma account delegate is available)
        const accountDelegate: any = (db as any)?.account;
        let existingAccount: any = null;
        if (accountDelegate?.findUnique) {
          existingAccount = await accountDelegate.findUnique({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
          });
        }

        // If the account does not exist, create it (when supported)
        if (!existingAccount && accountDelegate?.create) {
          await accountDelegate.create({
            data: {
              userId: (existingUser as any).id,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              refreshToken: (account as any).refresh_token,
              accessToken: (account as any).access_token,
              expiresAt: (account as any).expires_at,
              tokenType: (account as any).token_type,
              scope: (account as any).scope,
              idToken: (account as any).id_token,
              sessionState: (account as any).session_state,
            },
          });
        }
      }

      return true;
    },

    async jwt({ token, user, account }) {
      if(!token.sub) return token;
      const existingUser = await getUserById(token.sub)

      if(!existingUser) return token;

      const exisitingAccount = await getAccountByUserId(existingUser.id);

      token.name = existingUser.name;
      token.email = existingUser.email;
      token.role = existingUser.role;

      return token;
    },

    async session({ session, token }) {
      // Attach the user ID from the token to the session
    if(token.sub  && session.user){
      session.user.id = token.sub
    } 

    if(token.sub && session.user){
      session.user.role = token.role
    }

    return session;
    },
  },
  
  secret: process.env.AUTH_SECRET,
  adapter: hasPrisma ? (PrismaAdapter as any)(db as any) : undefined,
  session: { strategy: "jwt" },
  ...authConfig,
})