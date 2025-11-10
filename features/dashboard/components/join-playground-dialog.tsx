"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Users, Copy, Check } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

interface JoinPlaygroundDialogProps {
  children: React.ReactNode
}

export function JoinPlaygroundDialog({ children }: JoinPlaygroundDialogProps) {
  const [playgroundId, setPlaygroundId] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()

  const handleJoin = () => {
    if (!playgroundId.trim()) {
      toast.error("Please enter a playground ID")
      return
    }
    
    // Navigate to the playground
    router.push(`/playground/${playgroundId}`)
    setIsOpen(false)
    setPlaygroundId("")
    toast.success("Joining playground...")
  }

  const handleCopyCurrentUrl = () => {
    const currentUrl = window.location.href
    navigator.clipboard.writeText(currentUrl)
    toast.success("Dashboard URL copied to clipboard")
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Join Playground
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Enter a playground ID to join an existing collaborative session.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="space-y-2">
            <Label htmlFor="playground-id">
              Playground ID
            </Label>
            <Input
              id="playground-id"
              value={playgroundId}
              onChange={(e) => setPlaygroundId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleJoin() }}
              placeholder="Enter playground ID..."
              autoFocus
            />
          </div>
        </div>
        <DialogFooter className="flex w-full items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={handleCopyCurrentUrl}
            className="flex items-center gap-2"
          >
            <Copy className="h-4 w-4" />
            Copy Dashboard URL
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleJoin}>
              Join Playground
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
