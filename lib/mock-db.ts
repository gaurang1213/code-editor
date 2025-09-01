import type { Playground, TemplateFile, User } from '@prisma/client';

// Mock data for development
const mockPlaygrounds: Playground[] = [
  {
    id: 'mock-playground-1',
    title: 'React TypeScript Starter',
    description: 'A basic React TypeScript project',
    template: 'REACT',
    userId: 'mock-user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'mock-playground-2',
    title: 'Next.js Starter',
    description: 'A basic Next.js project',
    template: 'NEXTJS',
    userId: 'mock-user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockTemplateFiles: TemplateFile[] = [
  {
    id: 'mock-template-1',
    content: {
      folderName: 'Root',
      items: [
        {
          filename: 'package.json',
          fileExtension: 'json',
          content: JSON.stringify({
            name: 'react-ts-starter',
            version: '0.1.0',
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
              typescript: '^5.0.0'
            }
          }, null, 2)
        },
        {
          filename: 'src',
          fileExtension: '',
          content: 'folder'
        }
      ]
    },
    playgroundId: 'mock-playground-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
];

const mockUsers: User[] = [
  {
    id: 'mock-user-1',
    name: 'Demo User',
    email: 'demo@example.com',
    image: null,
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
];

export const mockDb = {
  playground: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      return mockPlaygrounds.find(p => p.id === where.id) || null;
    },
    findMany: async () => mockPlaygrounds,
    create: async (data: any) => {
      const newPlayground = {
        ...data.data,
        id: `mock-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPlaygrounds.push(newPlayground);
      return newPlayground;
    },
    update: async ({ where, data }: { where: { id: string }, data: any }) => {
      const index = mockPlaygrounds.findIndex(p => p.id === where.id);
      if (index !== -1) {
        mockPlaygrounds[index] = { ...mockPlaygrounds[index], ...data, updatedAt: new Date() };
        return mockPlaygrounds[index];
      }
      return null;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = mockPlaygrounds.findIndex(p => p.id === where.id);
      if (index !== -1) {
        const deleted = mockPlaygrounds.splice(index, 1)[0];
        return deleted;
      }
      return null;
    }
  },
  templateFile: {
    findUnique: async ({ where }: { where: { playgroundId: string } }) => {
      return mockTemplateFiles.find(t => t.playgroundId === where.playgroundId) || null;
    },
    create: async (data: any) => {
      const newTemplateFile = {
        ...data.data,
        id: `mock-template-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockTemplateFiles.push(newTemplateFile);
      return newTemplateFile;
    },
    update: async ({ where, data }: { where: { playgroundId: string }, data: any }) => {
      const index = mockTemplateFiles.findIndex(t => t.playgroundId === where.playgroundId);
      if (index !== -1) {
        mockTemplateFiles[index] = { ...mockTemplateFiles[index], ...data, updatedAt: new Date() };
        return mockTemplateFiles[index];
      }
      return null;
    }
  },
  user: {
    findUnique: async ({ where }: { where: { email: string } }) => {
      return mockUsers.find(u => u.email === where.email) || null;
    },
    findUniqueById: async ({ where }: { where: { id: string } }) => {
      return mockUsers.find(u => u.id === where.id) || null;
    }
  }
};
