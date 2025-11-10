import { useState, useEffect, useCallback } from 'react';
import { WebContainer } from '@webcontainer/api';
import { TemplateFolder } from '@/features/playground/libs/path-to-json';

interface UseWebContainerProps {
  templateData: TemplateFolder;
  resetKey?: string; // changing this will teardown and re-boot the container
}

interface UseWebContainerReturn {
  serverUrl: string | null;
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (path: string, content: string) => Promise<void>;
  destroy: () => void; // Added destroy function
}

// Module-scoped singleton to satisfy WebContainer's single-instance restriction
let bootPromise: Promise<WebContainer> | null = null;
let singleton: WebContainer | null = null;

async function bootSingleton(): Promise<WebContainer> {
  if (singleton) return singleton;
  if (!bootPromise) {
    bootPromise = WebContainer.boot();
  }
  singleton = await bootPromise;
  return singleton;
}

async function resetSingleton(): Promise<void> {
  if (singleton) {
    try { await singleton.teardown(); } catch {}
  }
  singleton = null;
  bootPromise = null;
}

export const useWebContainer = ({ templateData, resetKey }: UseWebContainerProps): UseWebContainerReturn => {

  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<WebContainer | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initializeWebContainer() {
      try {
        setIsLoading(true);
        setError(null);
        // Explicitly reset previous singleton before booting new instance
        await resetSingleton();
        const webcontainerInstance = await bootSingleton();
        if (!mounted) return;
        setInstance(webcontainerInstance);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize WebContainer:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize WebContainer');
          setIsLoading(false);
        }
      }
    }

    initializeWebContainer();

    return () => {
      mounted = false;
      // Do not teardown here to avoid flapping across re-mounts; reset happens on next initialize
    };
  // Re-run when resetKey changes to reboot container for a new playground
  }, [resetKey]);

  const writeFileSync = useCallback(async (path: string, content: string): Promise<void> => {
    if (!instance) {
      throw new Error('WebContainer instance is not available');
    }

    try {
      // Ensure the folder structure exists
      const pathParts = path.split('/');
      const folderPath = pathParts.slice(0, -1).join('/'); // Extract folder path

      if (folderPath) {
        await instance.fs.mkdir(folderPath, { recursive: true }); // Create folder structure recursively
      }

      // Write the file
      await instance.fs.writeFile(path, content);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to write file';
      console.error(`Failed to write file at ${path}:`, err);
      throw new Error(`Failed to write file at ${path}: ${errorMessage}`);
    }
  }, [instance]);

  // Added destroy function
  const destroy = useCallback(() => {
    if (instance) {
      instance.teardown();
      setInstance(null);
      setServerUrl(null);
    }
  }, [instance]);

  return { serverUrl, isLoading, error, instance, writeFileSync, destroy };
};