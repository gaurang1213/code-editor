"use client"

import { useRef, useEffect } from "react"
import Editor, { type Monaco } from "@monaco-editor/react"
import { configureMonaco, defaultEditorOptions, getEditorLanguage } from "@/features/playground/libs/editor-config"
import type { TemplateFile } from "@/features/playground/libs/path-to-json"

interface PlaygroundEditorProps {
  activeFile: TemplateFile | undefined
  content: string
  onContentChange: (value: string) => void
}

export const PlaygroundEditor = ({
  activeFile,
  content,
  onContentChange,
}: PlaygroundEditorProps) => {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    // Safety check to ensure editor and monaco are properly initialized
    if (!editor || !monaco) {
      console.warn("Editor or Monaco not properly initialized")
      return
    }
    
    editorRef.current = editor
    monacoRef.current = monaco
    console.log("Editor instance mounted:", !!editorRef.current)

    if (editor && typeof editor.updateOptions === 'function') {
      editor.updateOptions({
        ...defaultEditorOptions,
        // Enable inline suggestions but with specific settings to prevent conflicts
        inlineSuggest: {
          enabled: true,
          mode: "prefix",
          suppressSuggestions: false,
        },
        // Disable some conflicting suggest features
        suggest: {
          preview: false, // Disable preview to avoid conflicts
          showInlineDetails: false,
          insertMode: "replace",
        },
        // Quick suggestions
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },
        // Smooth cursor
        cursorSmoothCaretAnimation: "on",
      })
    }

    if (typeof configureMonaco === 'function') {
      configureMonaco(monaco)
    }
  }

  const updateEditorLanguage = () => {
    if (!activeFile || !monacoRef.current || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return

    const language = getEditorLanguage(activeFile.fileExtension || "")
    try {
      monacoRef.current.editor.setModelLanguage(model, language)
    } catch (error) {
      console.warn("Failed to set editor language:", error)
    }
  }

  useEffect(() => {
    updateEditorLanguage()
  }, [activeFile])

  return (
    <div className="h-full relative">
      <Editor
        height="100%"
        value={content}
        onChange={(value) => onContentChange(value || "")}
        onMount={handleEditorDidMount}
        language={activeFile ? getEditorLanguage(activeFile.fileExtension || "") : "plaintext"}
        options={defaultEditorOptions}
      />
    </div>
  )
}