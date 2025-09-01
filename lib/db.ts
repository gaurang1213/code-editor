import { PrismaClient } from "@prisma/client"
import { mockDb } from "./mock-db"
 
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// Use mock database if DATABASE_URL is not set (for development)
const useMockDb = !process.env.DATABASE_URL

let prisma: PrismaClient | null = null

if (!useMockDb) {
  try {
    prisma = globalForPrisma.prisma || new PrismaClient()
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
  } catch (error) {
    console.warn("Failed to connect to database, falling back to mock database:", error)
    prisma = null
  }
}

export const db = prisma || mockDb