"use client";

import React, { useRef } from "react";
import { useState, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { TemplateFileTree } from "@/features/playground/components/playground-explorer";
import type { TemplateFile } from "@/features/playground/libs/path-to-json";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  FolderOpen,
  AlertCircle,
  Save,
  X,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import WebContainerPreview from "@/features/webcontainers/components/webcontainer-preveiw";
import LoadingStep from "@/components/ui/loader";
import { PlaygroundEditor } from "@/features/playground/components/playground-editor";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import { usePlayground } from "@/features/playground/hooks/usePlayground";
import { useWebContainer } from "@/features/webcontainers/hooks/useWebContainer";
import { SaveUpdatedCode } from "@/features/playground/actions";
import { TemplateFolder } from "@/features/playground/types";
import { findFilePath } from "@/features/playground/libs";
import { ConfirmationDialog } from "@/features/playground/components/dialogs/conformation-dialog";
import { useCollaboration } from "@/features/playground/hooks/useCollaboration";

const MainPlaygroundPage: React.FC = () => {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  // UI state
  const [confirmationDialog, setConfirmationDialog] = useState({
    isOpen: false,
    title: "",
    description: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const [isPreviewVisible, setIsPreviewVisible] = useState(true);

  // Custom hooks
  const { playgroundData, templateData, isLoading, error, saveTemplateData } =
    usePlayground(id || "");
  const {
    templateData: templateDataStore,
    activeFileId,
    closeAllFiles,
    openFile,
    closeFile,
    editorContent,
    updateFileContent,
    applyRemoteContent,
    handleAddFile,
    handleAddFolder,
    handleDeleteFile,
    handleDeleteFolder,
    handleRenameFile,
    handleRenameFolder,
    openFiles,
    setTemplateData,
    setActiveFileId,
    setPlaygroundId,
    setOpenFiles,
    markFileSaved,
    updateTemplateFileContent,
  } = useFileExplorer();

  const {
    serverUrl,
    isLoading: containerLoading,
    error: containerError,
    instance,
    writeFileSync,
  } = useWebContainer({ templateData, resetKey: id || "" });

  const lastSyncedContent = useRef<Map<string, string>>(new Map());
  const lastRemoteTsRef = useRef<Map<string, number>>(new Map());
  const lastSavedTsRef = useRef<Map<string, number>>(new Map());

  function getTemplateContentById(fileId: string): string | undefined {
    try {
      if (!templateDataStore) return undefined;
      const parts = fileId.split('/').filter(Boolean);
      const fname = parts.pop() || "";
      const [name, ...extParts] = fname.split('.');
      const ext = extParts.join('.');
      let folder = templateDataStore as any;
      for (const p of parts) {
        const f = folder.items.find((it: any) => 'folderName' in it && it.folderName === p) as any;
        if (!f) { folder = templateDataStore; break; }
        folder = f;
      }

      const match = folder.items.find((it: any) => 'filename' in it && it.filename === name && it.fileExtension === ext) as any;
      if (match && typeof match.content === 'string') return match.content as string;
    } catch {}
    return undefined;
  }

  // Normalize file IDs to avoid duplicates like "name.ext/name.ext"
  function normalizeFileId(id: string | undefined | null): string {
    if (!id) return '';
    const parts = id.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      if (last && prev && last === prev) {
        parts.splice(parts.length - 2, 1);
      }
    }
    return parts.join('/');
  }

  // Collaboration
  const { 
    connected, 
    clients, 
    join, 
    broadcastContentChange, 
    broadcastSaved, 
    onRemoteContentChange, 
    onRemoteSaved, 
    broadcastFileOp, 
    onRemoteFileOp, 
    requestFile,
    getSocketId
  } = useCollaboration({ playgroundId: id || "" });
  
  // Get current socket ID - this will be stable across re-renders
  const socketId = getSocketId();

  // Set current playground id in store
  React.useEffect(() => {
    if (id) {
      setPlaygroundId(id);
    }
  }, [id, setPlaygroundId]);

  // Reset explorer state when switching playgrounds and re-join collab room
  React.useEffect(() => {
    if (!id) return;
    // Clear current files and tree immediately to avoid showing previous project's files
    closeAllFiles();
    setTemplateData(null);
    // Ask collab to join new room (if socket is connected, this will be immediate; otherwise it will join on open)
    try {
      join(id);
    } catch {}
    // Reset last synced cache
    lastSyncedContent.current = new Map();
  }, [id, join, closeAllFiles, setTemplateData]);

  // Apply template data whenever it updates from usePlayground (covers first load and id changes)
  React.useEffect(() => {
    if (templateData) {
      setTemplateData(templateData);
    }
  }, [templateData, setTemplateData]);

  // When the template tree in the store updates, refresh the active file's content
  // from the latest template if there are no unsaved changes in the tab.
  React.useEffect(() => {
    if (!templateDataStore || !activeFileId) return;
    const active = openFiles.find(f => f.id === activeFileId);
    if (!active || active.hasUnsavedChanges) return;
    try {
      const parts = activeFileId.split('/').filter(Boolean);
      const fname = parts.pop() || "";
      const [name, ...extParts] = fname.split('.');
      const ext = extParts.join('.');
      let folder = templateDataStore as any;
      for (const p of parts) {
        const f = folder.items.find((it: any) => 'folderName' in it && it.folderName === p) as any;
        if (!f) { folder = templateDataStore; break; }
        folder = f;
      }
      const match = folder.items.find((it: any) => 'filename' in it && it.filename === name && it.fileExtension === ext) as any;
      if (match && typeof match.content === 'string' && match.content !== active.content) {
        updateFileContent(activeFileId, match.content);
        markFileSaved(activeFileId, match.content);
      }
    } catch {}
  }, [templateDataStore, activeFileId, openFiles, updateFileContent, markFileSaved]);

  // Do NOT auto-request file content from server to avoid clobbering with empty snapshots on join

  // Apply incoming remote content changes
  React.useEffect(() => {
    return onRemoteContentChange(async ({ fileId, content, ts, peerId }) => {
      // Ignore our own messages (handled by local state)
      if (peerId === socketId) {
        console.log('[collab] Ignoring our own content change');
        return;
      }

      if (!fileId) {
        console.log('[collab] Ignoring content change with no fileId');
        return;
      }

      // Log the incoming change for debugging
      try {
        console.log('[collab] Received content change:', {
          fileId,
          contentLength: (content || '').length,
          ts: typeof ts === 'number' ? ts : 'none',
          fromPeer: peerId || 'unknown'
        });
      } catch (e) {
        console.error('[collab] Error logging content change:', e);
      }

      // Apply the remote content immediately without any timestamp checks
      // This ensures real-time updates for typing
      try {
        // Find the target file using multiple matching strategies
        const targetFile = openFiles.find(f => {
          if (!f.id) return false;
          
          // Exact match
          if (f.id === fileId) return true;
          
          // Filename match (last segment)
          const fileSegments = f.id.split('/');
          const idSegments = fileId.split('/');
          const fileBase = fileSegments[fileSegments.length - 1];
          const idBase = idSegments[idSegments.length - 1];
          
          if (fileBase === idBase) return true;
          
          // Check if one is a suffix of the other
          if (f.id.endsWith('/' + fileId) || fileId.endsWith('/' + f.id)) {
            return true;
          }
          
          return false;
        });
        
        const localId = targetFile?.id || fileId;
        
        console.log('[collab] Applying remote content:', {
          originalFileId: fileId,
          localId,
          hasTarget: !!targetFile,
          contentLength: (content || '').length
        });
        
        // Apply the remote content
        applyRemoteContent(localId, content || '');
        
        // Update the last timestamp for this file if we have one
        if (ts) {
          lastRemoteTsRef.current.set(localId, ts);
        }
      } catch (e) {
        console.error('[collab] Error applying remote content:', e);
      }
    });
  }, [onRemoteContentChange, openFiles, applyRemoteContent, socketId]);

  // Apply incoming remote save events to update content, clear unsaved badge, and sync template
  React.useEffect(() => {
    return onRemoteSaved(async ({ fileId, content, ts }) => {
      const normId = normalizeFileId(fileId);
      if (!normId) return;
      const targetFile = openFiles.find((f) => f.id === normId) || openFiles.find((f) => normalizeFileId(f.id) === normId);
      const localId = targetFile?.id || normId;
      // Treat remote 'saved' as authoritative: apply if non-empty; if empty, don't clobber non-empty local
      const existing = getTemplateContentById(localId || "") ?? "";
      if ((content ?? "") === "" && existing.length > 0) {
        try { console.log('[collab]', JSON.stringify({ event: 'ignore-saved-empty', fileId: normId, existingLen: existing.length })); } catch {}
        return;
      }
      // Update template store first so any effects depending on it read fresh data
      try { console.log('[collab]', JSON.stringify({ event: 'apply-saved', fileId: normId, localId, len: (content||'').length })); } catch {}
      updateTemplateFileContent(localId, content || "");
      updateFileContent(localId, content || "");
      markFileSaved(localId, content || "");
      // Track ts for completeness but do not block application on ts
      const incomingTs = typeof ts === 'number' ? ts : 0;
      if (incomingTs) lastRemoteTsRef.current.set(normId || "", incomingTs);
      if (incomingTs) lastSavedTsRef.current.set(normId || "", incomingTs);

      // Also reflect remote saves into local WebContainer FS so preview stays in sync
      try {
        const latestTemplateData = useFileExplorer.getState().templateData;
        if (latestTemplateData && writeFileSync) {
          const mockFile = { id: localId } as any;
          const filePath = findFilePath(mockFile as any, latestTemplateData) || localId; // fallback to id path
          await writeFileSync(filePath, content || "");
          if (instance && instance.fs) {
            await instance.fs.writeFile(filePath, content || "");
          }
        }
      } catch {}
    });
  }, [onRemoteSaved, updateFileContent, markFileSaved, updateTemplateFileContent]);

  // Apply incoming remote file operations (add/rename/delete)
  React.useEffect(() => {
    return onRemoteFileOp(async (payload) => {
      const { type, fileId, folderId, newName, newExtension, parentPath, file, folder } = payload || {};
      
      console.log("Received remote file operation:", type, payload);
      
      // Use a no-op saver to avoid persisting from every client. The author persists.
      const saveNoop = async (_data: TemplateFolder) => {};

      switch (type) {
        case 'add-file':
          if (file && parentPath !== undefined) {
            await handleAddFile(file, parentPath, writeFileSync!, instance, saveNoop, false);
            const currentTemplateData = useFileExplorer.getState().templateData;
            if (currentTemplateData) {
              setTemplateData({ ...currentTemplateData });
            }
          }
          break;
        case 'add-folder':
          if (folder && parentPath !== undefined) {
            await handleAddFolder(folder, parentPath, instance, saveNoop);
            const currentTemplateData = useFileExplorer.getState().templateData;
            if (currentTemplateData) {
              setTemplateData({ ...currentTemplateData });
            }
          }
          break;
        case 'delete-file':
          if (file && parentPath !== undefined) {
            // Ensure tab closes even if ID resolution differs
            const guessedId = `${parentPath ? parentPath + '/' : ''}${file.filename}${file.fileExtension ? '.' + file.fileExtension : ''}`;
            try { closeFile(guessedId); } catch {}
            await handleDeleteFile(file, parentPath, saveNoop);
            const currentTemplateData = useFileExplorer.getState().templateData;
            if (currentTemplateData) {
              setTemplateData({ ...currentTemplateData });
            }
          }
          break;
        case 'delete-folder':
          if (folder && parentPath !== undefined) {
            await handleDeleteFolder(folder, parentPath, saveNoop);
            const currentTemplateData = useFileExplorer.getState().templateData;
            if (currentTemplateData) {
              setTemplateData({ ...currentTemplateData });
            }
          }
          break;
        case 'rename-file':
          if (file && newName && newExtension && parentPath !== undefined) {
            await handleRenameFile(file, newName, newExtension, parentPath, saveNoop);
            const currentTemplateData = useFileExplorer.getState().templateData;
            if (currentTemplateData) {
              setTemplateData({ ...currentTemplateData });
            }
          }
          break;
        case 'rename-folder':
          if (folder && newName && parentPath !== undefined) {
            await handleRenameFolder(folder, newName, parentPath, saveNoop);
            const currentTemplateData = useFileExplorer.getState().templateData;
            if (currentTemplateData) {
              setTemplateData({ ...currentTemplateData });
            }
          }
          break;
      }
    });
  }, [onRemoteFileOp, handleAddFile, handleAddFolder, handleDeleteFile, handleDeleteFolder, handleRenameFile, handleRenameFolder, writeFileSync, instance, setTemplateData]);

  // Create wrapper functions that pass saveTemplateData
  const wrappedHandleAddFile = useCallback(
    (newFile: TemplateFile, parentPath: string) => {
      console.log("Adding file locally:", newFile, parentPath);
      const result = handleAddFile(
        newFile,
        parentPath,
        writeFileSync!,
        instance,
        saveTemplateData
      );
      // Broadcast the file addition
      console.log("Broadcasting file addition:", { type: 'add-file', file: newFile, parentPath });
      broadcastFileOp({
        type: 'add-file',
        file: newFile,
        parentPath
      });
      return result;
    },
    [handleAddFile, writeFileSync, instance, saveTemplateData, broadcastFileOp]
  );

  const wrappedHandleAddFolder = useCallback(
    (newFolder: TemplateFolder, parentPath: string) => {
      console.log("Adding folder locally:", newFolder, parentPath);
      const result = handleAddFolder(newFolder, parentPath, instance, saveTemplateData);
      // Broadcast the folder addition
      console.log("Broadcasting folder addition:", { type: 'add-folder', folder: newFolder, parentPath });
      broadcastFileOp({
        type: 'add-folder',
        folder: newFolder,
        parentPath
      });
      return result;
    },
    [handleAddFolder, instance, saveTemplateData, broadcastFileOp]
  );

  const wrappedHandleDeleteFile = useCallback(
    (file: TemplateFile, parentPath: string) => {
      console.log("Deleting file locally:", file, parentPath);
      const result = handleDeleteFile(file, parentPath, saveTemplateData);
      // Broadcast the file deletion
      console.log("Broadcasting file deletion:", { type: 'delete-file', file, parentPath });
      broadcastFileOp({
        type: 'delete-file',
        file,
        parentPath
      });
      return result;
    },
    [handleDeleteFile, saveTemplateData, broadcastFileOp]
  );

  const wrappedHandleDeleteFolder = useCallback(
    (folder: TemplateFolder, parentPath: string) => {
      const result = handleDeleteFolder(folder, parentPath, saveTemplateData);
      // Broadcast the folder deletion
      broadcastFileOp({
        type: 'delete-folder',
        folder,
        parentPath
      });
      return result;
    },
    [handleDeleteFolder, saveTemplateData, broadcastFileOp]
  );

  const wrappedHandleRenameFile = useCallback(
    (
      file: TemplateFile,
      newFilename: string,
      newExtension: string,
      parentPath: string
    ) => {
      const result = handleRenameFile(
        file,
        newFilename,
        newExtension,
        parentPath,
        saveTemplateData
      );
      // Broadcast the file rename
      broadcastFileOp({
        type: 'rename-file',
        file,
        newName: newFilename,
        newExtension,
        parentPath
      });
      return result;
    },
    [handleRenameFile, saveTemplateData, broadcastFileOp]
  );

  const wrappedHandleRenameFolder = useCallback(
    (folder: TemplateFolder, newFolderName: string, parentPath: string) => {
      const result = handleRenameFolder(
        folder,
        newFolderName,
        parentPath,
        saveTemplateData
      );
      // Broadcast the folder rename
      broadcastFileOp({
        type: 'rename-folder',
        folder,
        newName: newFolderName,
        parentPath
      });
      return result;
    },
    [handleRenameFolder, saveTemplateData, broadcastFileOp]
  );

  const activeFile = openFiles.find((file) => file.id === activeFileId);
  const hasUnsavedChanges = openFiles.some((file) => file.hasUnsavedChanges);

  const handleFileSelect = (file: TemplateFile) => {
    openFile(file);
  };

  const handleSave = useCallback(
    async (fileId?: string) => {
      const targetFileId = fileId || activeFileId;
      if (!targetFileId) return;

      const fileToSave = openFiles.find((f) => f.id === targetFileId);
      if (!fileToSave) return;

      const latestTemplateData = useFileExplorer.getState().templateData;
      if (!latestTemplateData) return;

      try {
        const filePath = findFilePath(fileToSave, latestTemplateData);
        if (!filePath) {
          toast.error(
            `Could not find path for file: ${fileToSave.filename}.${fileToSave.fileExtension}`
          );
          return;
        }

        // Update file content in template data (clone for immutability)
        const updatedTemplateData = JSON.parse(
          JSON.stringify(latestTemplateData)
        );
        const updateFileContent = (items: any[]): any[] =>
          items.map((item) => {
            if ("folderName" in item) {
              return { ...item, items: updateFileContent(item.items) };
            } else if (
              item.filename === fileToSave.filename &&
              item.fileExtension === fileToSave.fileExtension
            ) {
              return { ...item, content: fileToSave.content };
            }
            return item;
          });
        updatedTemplateData.items = updateFileContent(
          updatedTemplateData.items
        );

        // Sync with WebContainer
        if (writeFileSync) {
          await writeFileSync(filePath, fileToSave.content);
          lastSyncedContent.current.set(fileToSave.id, fileToSave.content);
          if (instance && instance.fs) {
            await instance.fs.writeFile(filePath, fileToSave.content);
          }
        }

        // Use saveTemplateData to persist changes
        await saveTemplateData(updatedTemplateData);
        setTemplateData(updatedTemplateData);

        // Update open files
        const updatedOpenFiles = openFiles.map((f) =>
          f.id === targetFileId
            ? {
                ...f,
                content: fileToSave.content,
                originalContent: fileToSave.content,
                hasUnsavedChanges: false,
              }
            : f
        );
        setOpenFiles(updatedOpenFiles);

        // Persist content into templateData so closed files reopen with the latest
        updateTemplateFileContent(targetFileId, fileToSave.content || "");

        // Broadcast only the saved snapshot to other users (with content)
        console.log("Broadcasting saved content:", { fileId: targetFileId, content: fileToSave.content?.substring(0, 50) + "..." });
        broadcastSaved({ fileId: normalizeFileId(targetFileId), content: fileToSave.content });

        toast.success(
          `Saved ${fileToSave.filename}.${fileToSave.fileExtension}`
        );
      } catch (error) {
        console.error("Error saving file:", error);
        toast.error(
          `Failed to save ${fileToSave.filename}.${fileToSave.fileExtension}`
        );
        throw error;
      }
    },
    [
      activeFileId,
      openFiles,
      writeFileSync,
      instance,
      saveTemplateData,
      setTemplateData,
      setOpenFiles,
    ]
  );

  const handleSaveAll = async () => {
    const unsavedFiles = openFiles.filter((f) => f.hasUnsavedChanges);

    if (unsavedFiles.length === 0) {
      toast.info("No unsaved changes");
      return;
    }

    try {
      await Promise.all(unsavedFiles.map((f) => handleSave(f.id)));
      toast.success(`Saved ${unsavedFiles.length} file(s)`);
    } catch (error) {
      toast.error("Failed to save some files");
    }
  };

  // Add event to save file by click ctrl + s
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-red-600 mb-2">
          Something went wrong
        </h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()} variant="destructive">
          Try Again
        </Button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <div className="w-full max-w-md p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-semibold mb-6 text-center">
            Loading Playground
          </h2>
          <div className="mb-8">
            <LoadingStep
              currentStep={1}
              step={1}
              label="Loading playground data"
            />
            <LoadingStep
              currentStep={2}
              step={2}
              label="Setting up environment"
            />
            <LoadingStep currentStep={3} step={3} label="Ready to code" />
          </div>
        </div>
      </div>
    );
  }

  // No template data
  if (!templateDataStore) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <FolderOpen className="h-12 w-12 text-amber-500 mb-4" />
        <h2 className="text-xl font-semibold text-amber-600 mb-2">
          No template data available
        </h2>
        <Button onClick={() => window.location.reload()} variant="outline">
          Reload Template
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <>
        <TemplateFileTree
          data={templateDataStore}
          onFileSelect={handleFileSelect}
          selectedFile={activeFile}
          title="File Explorer"
          onAddFile={wrappedHandleAddFile}
          onAddFolder={wrappedHandleAddFolder}
          onDeleteFile={wrappedHandleDeleteFile}
          onDeleteFolder={wrappedHandleDeleteFolder}
          onRenameFile={wrappedHandleRenameFile}
          onRenameFolder={wrappedHandleRenameFolder}
        />

        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />

            <div className="flex flex-1 items-center gap-2">
              <div className="flex flex-col flex-1">
                <h1 className="text-sm font-medium">
                  {playgroundData?.name || "Code Playground"}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {openFiles.length} file(s) open
                  {hasUnsavedChanges && " • Unsaved changes"}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* Connected users */}
                <div className="flex items-center gap-1">
                  <div className="flex -space-x-2">
                    {clients.slice(0,5).map((c) => {
                      const name = c.username || "User";
                      const initials = name.split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||"").join("");
                      return (
                        <div key={c.socketId} className="h-7 w-7 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[10px] font-medium">
                          {initials || "U"}
                        </div>
                      );
                    })}
                    {clients.length > 5 && (
                      <div className="h-7 w-7 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[10px] font-medium">+{clients.length-5}</div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{clients.length} online{connected ? "" : " (reconnecting...)"}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSave()}
                      disabled={!activeFile || !activeFile.hasUnsavedChanges}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save (Ctrl+S)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveAll}
                      disabled={!hasUnsavedChanges}
                    >
                      <Save className="h-4 w-4" /> All
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save All (Ctrl+Shift+S)</TooltipContent>
                </Tooltip>


                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setIsPreviewVisible(!isPreviewVisible)}
                    >
                      {isPreviewVisible ? "Hide" : "Show"} Preview
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={closeAllFiles}>
                      Close All Files
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <div className="h-[calc(100vh-4rem)]">
            {openFiles.length > 0 ? (
              <div className="h-full flex flex-col">
                {/* File Tabs */}
                <div className="border-b bg-muted/30">
                  <Tabs
                    value={activeFileId || ""}
                    onValueChange={setActiveFileId}
                  >
                    <div className="flex items-center justify-between px-4 py-2">
                      <TabsList className="h-8 bg-transparent p-0">
                        {openFiles.map((file) => (
                          <TabsTrigger
                            key={file.id}
                            value={file.id}
                            className="relative h-8 px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm group"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-3 w-3" />
                              <span>
                                {file.filename}.{file.fileExtension}
                              </span>
                              {file.hasUnsavedChanges && (
                                <span className="h-2 w-2 rounded-full bg-orange-500" />
                              )}
                              <span
                                className="ml-2 h-4 w-4 hover:bg-destructive hover:text-destructive-foreground rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeFile(file.id);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </span>
                            </div>
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      {openFiles.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={closeAllFiles}
                          className="h-6 px-2 text-xs"
                        >
                          Close All
                        </Button>
                      )}
                    </div>
                  </Tabs>
                </div>

                {/* Editor and Preview */}
                <div className="flex-1">
                  <ResizablePanelGroup
                    direction="horizontal"
                    className="h-full"
                  >
                    <ResizablePanel defaultSize={isPreviewVisible ? 50 : 100}>
                      <PlaygroundEditor
                        activeFile={activeFile}
                        content={activeFile?.content || ""}
                        onContentChange={(value) => {
                          if (activeFileId) {
                            updateFileContent(activeFileId, value);
                            const wireId = normalizeFileId(activeFileId);
                            broadcastContentChange({ fileId: wireId, content: value });
                          }
                        }}
                      />
                    </ResizablePanel>

                    {isPreviewVisible && (
                      <>
                        <ResizableHandle />
                        <ResizablePanel defaultSize={50}>
                          <WebContainerPreview
                            key={id}
                            templateData={templateDataStore}
                            instance={instance}
                            writeFileSync={writeFileSync}
                            isLoading={containerLoading}
                            error={containerError}
                            serverUrl={serverUrl!}
                            forceResetup={false}
                          />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full items-center justify-center text-muted-foreground gap-4">
                <FileText className="h-16 w-16 text-gray-300" />
                <div className="text-center">
                  <p className="text-lg font-medium">No files open</p>
                  <p className="text-sm text-gray-500">
                    Select a file from the sidebar to start editing
                  </p>
                </div>
              </div>
            )}
          </div>
        </SidebarInset>

      <ConfirmationDialog
      isOpen={confirmationDialog.isOpen}
      title={confirmationDialog.title}
      description={confirmationDialog.description}
      onConfirm={confirmationDialog.onConfirm}
      onCancel={confirmationDialog.onCancel}
      setIsOpen={(open) => setConfirmationDialog((prev) => ({ ...prev, isOpen: open }))}
      />
      </>
    </TooltipProvider>
  );
};

export default MainPlaygroundPage;
