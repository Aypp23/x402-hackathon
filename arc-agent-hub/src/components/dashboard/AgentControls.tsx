import { useState } from 'react';
import { Power, Lock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

interface AgentControlsProps {
  agentId?: string;
  isActive: boolean;
  onToggle: () => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function AgentControls({ agentId, isActive, onToggle }: AgentControlsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      if (!agentId) {
        throw new Error('No agent selected');
      }

      const res = await fetch(`${API_BASE_URL}/admin/policy/${agentId}/freeze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ADMIN_API_KEY ? { 'x-admin-key': ADMIN_API_KEY } : {}),
          'x-admin-user': 'dashboard-ui',
        },
        body: JSON.stringify({ frozen: isActive }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to update policy (${res.status})`);
      }

      onToggle();
      setIsModalOpen(false);
      toast.success(isActive ? 'Agent has been frozen' : 'Agent has been reactivated');
    } catch (error) {
      toast.error((error as Error).message || 'Failed to update policy');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="liquid-glass-card liquid-glass-shimmer p-5 flex flex-col h-full">
        <h3 className="text-lg font-medium text-foreground mb-6">Agent Controls</h3>
        
        <div className="flex-1">
          <div className="p-4 rounded-xl bg-secondary border border-border/30">
            <div className="flex items-center gap-3 text-foreground mb-2">
              <Lock className="w-4 h-4" />
              <span className="font-medium text-sm">Permissions</span>
            </div>
            <p className="text-xs text-muted-foreground">Agent has access to Treasury and Chat.</p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border/50">
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={isLoading}
            className={cn(
              "w-full py-3 rounded-full font-medium flex items-center justify-center gap-2 transition-all text-sm",
              isActive
                ? "bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-950/50"
                : "bg-emerald-950/30 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-950/50",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <>
                <Power className="w-4 h-4" />
                {isActive ? 'FREEZE AGENT' : 'REACTIVATE AGENT'}
              </>
            )}
          </button>
          <p className="text-center text-[10px] text-muted-foreground mt-3">
            {isActive 
              ? "Stops all spending and agent activities immediately." 
              : "Resumes normal agent operations."}
          </p>
        </div>
      </div>

      <AlertDialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <AlertDialogContent className="rounded-xl max-w-sm">
          <AlertDialogHeader className="text-center">
            <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <AlertDialogTitle className="text-center">
              {isActive ? 'Freeze Agent?' : 'Reactivate Agent?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-sm">
              {isActive
                ? 'Are you sure you want to freeze this agent? It will stop responding to queries and executing transactions immediately.'
                : 'Are you sure you want to reactivate this agent? It will resume operations immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-3 sm:flex-row">
            <AlertDialogCancel className="flex-1 rounded-full bg-secondary hover:bg-secondary/80 border-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleToggle}
              className={cn(
                "flex-1 rounded-full",
                isActive 
                  ? "bg-red-700 hover:bg-red-600 text-white" 
                  : "bg-emerald-700 hover:bg-emerald-600 text-white"
              )}
            >
              {isActive ? 'Yes, Freeze' : 'Yes, Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
