import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useWallet } from '@/contexts/WalletContext';
import { Layout } from '@/components/layout/Layout';
import { TreasuryCard } from '@/components/dashboard/TreasuryCard';
import { TasksCard } from '@/components/dashboard/TasksCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { AgentControls } from '@/components/dashboard/AgentControls';
import { cn } from '@/lib/utils';

interface LocationState {
  providerId?: string;
  providerName?: string;
  providerIsFrozen?: boolean;
}

const Dashboard = () => {
  const { address } = useWallet();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const hasAdminPolicyKey = Boolean(import.meta.env.VITE_ADMIN_API_KEY);

  const [isOwner, setIsOwner] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState<boolean>(() => {
    if (typeof locationState?.providerIsFrozen === 'boolean') {
      return !locationState.providerIsFrozen;
    }

    if (typeof window !== 'undefined') {
      const storedFrozen = localStorage.getItem('active_provider_is_frozen');
      if (storedFrozen === 'true') return false;
      if (storedFrozen === 'false') return true;
    }

    return true;
  });
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string; wallet?: string } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    treasury: "0.00",
    tasksCompleted: 0,
    rating: 0,
    totalRatings: 0,
    avgResponseTime: "0s"
  });
  const [spend, setSpend] = useState<{
    totalSpendUsd: number;
    paidCalls: number;
    budget: { limitUsd: number; spentUsdEnd: number; remainingUsdEnd: number };
    receipts: Array<{
      agentId: string;
      endpoint: string;
      amount: string;
      amountUsd: number;
      payTo: string;
      txHash: string | null;
      receiptRef: string | null;
      settledAt: string;
      success: boolean;
    }>;
    decisionLog: Array<{
      stepIndex: number;
      toolName: string;
      endpoint: string;
      quotedPriceUsd: number;
      reason: string;
      budgetBeforeUsd: number;
      budgetAfterUsd: number;
      outcome: 'success' | 'skipped' | 'failed';
      receiptRef?: string;
      latencyMs?: number;
    }>;
    traceId: string | null;
  }>({
    totalSpendUsd: 0,
    paidCalls: 0,
    budget: { limitUsd: 1, spentUsdEnd: 0, remainingUsdEnd: 1 },
    receipts: [],
    decisionLog: [],
    traceId: null
  });

  // Load selected agent from navigation state or localStorage
  useEffect(() => {
    if (locationState?.providerId && locationState?.providerName) {
      setSelectedAgent({ id: locationState.providerId, name: locationState.providerName });
      if (typeof locationState.providerIsFrozen === 'boolean') {
        setIsAgentActive(!locationState.providerIsFrozen);
      }
    } else {
      const storedAgentId = localStorage.getItem('active_provider_id');
      const storedAgentName = localStorage.getItem('active_provider_name');
      if (storedAgentId) {
        setSelectedAgent({ id: storedAgentId, name: storedAgentName || '' });
      }

      const storedFrozen = localStorage.getItem('active_provider_is_frozen');
      if (storedFrozen === 'true') {
        setIsAgentActive(false);
      } else if (storedFrozen === 'false') {
        setIsAgentActive(true);
      }
    }
  }, [locationState]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const agentId = selectedAgent?.id || localStorage.getItem('active_provider_id');
        const url = agentId
          ? `${API_BASE_URL}/dashboard/stats?agentId=${agentId}`
          : `${API_BASE_URL}/dashboard/stats`;

        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json();

        setStats({
          treasury: data.treasury || "0.00",
          tasksCompleted: data.tasksCompleted || 0,
          rating: data.rating || 0,
          totalRatings: data.totalRatings || 0,
          avgResponseTime: data.avgResponseTime || "0s"
        });

        // Update agent name and wallet from backend if not already set
        if (data.agentName || data.wallet) {
          setSelectedAgent(prev => prev
            ? { ...prev, name: data.agentName || prev.name, wallet: data.wallet || prev.wallet }
            : { id: agentId || '', name: data.agentName, wallet: data.wallet });
        }

        if (data.isFrozen !== undefined) {
          setIsAgentActive(!data.isFrozen);
          localStorage.setItem('active_provider_is_frozen', String(Boolean(data.isFrozen)));
        }

        // Check ownership (fallback to agent wallet for x402 agents).
        const ownerAddress = (data.address || data.wallet || '').toLowerCase();
        if (ownerAddress && address) {
          setIsOwner(ownerAddress === address.toLowerCase());
        }

        const latestSessionId = localStorage.getItem('x402-chat-current-session');
        setActiveSessionId(latestSessionId);

        if (latestSessionId) {
          const spendParams = new URLSearchParams({
            sessionId: latestSessionId,
            limit: '20'
          });
          if (agentId) {
            spendParams.set('agentId', agentId);
          }

          const spendRes = await fetch(`${API_BASE_URL}/dashboard/spend?${spendParams.toString()}`, { cache: 'no-store' });
          const spendData = await spendRes.json();
          if (!spendData.error) {
            setSpend({
              totalSpendUsd: spendData.totalSpendUsd || 0,
              paidCalls: spendData.paidCalls || 0,
              budget: spendData.budget || { limitUsd: 1, spentUsdEnd: 0, remainingUsdEnd: 1 },
              receipts: spendData.receipts || [],
              decisionLog: spendData.decisionLog || [],
              traceId: spendData.traceId || null
            });
          }
        } else {
          setSpend({
            totalSpendUsd: 0,
            paidCalls: 0,
            budget: { limitUsd: 1, spentUsdEnd: 0, remainingUsdEnd: 1 },
            receipts: [],
            decisionLog: [],
            traceId: null
          });
        }

      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      }
    };

    fetchStats();
    // Refresh every 5 seconds
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [address, selectedAgent?.id]);
  const canManageAgent = isOwner || hasAdminPolicyKey;

  return (
    <Layout>
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="space-y-6 max-w-[1200px]">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3">
            <div>
              <h1 className="text-2xl font-medium text-foreground tracking-tight">
                {selectedAgent?.wallet ? (
                  <a
                    href={`https://sepolia.basescan.org/address/${selectedAgent.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors hover:underline"
                  >
                    {selectedAgent.name}
                  </a>
                ) : (
                  selectedAgent?.name || 'Dashboard'
                )}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {selectedAgent?.name
                  ? `Monitoring ${selectedAgent.name} performance and earnings.`
                  : "Monitor your AI agent's performance and earnings."}
              </p>
            </div>
            <div className={cn(
              "px-4 py-1.5 rounded-full border flex items-center gap-2 text-xs font-medium w-fit",
              isAgentActive
                ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-400"
                : "bg-red-950/30 border-red-800/50 text-red-400"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                isAgentActive ? "bg-emerald-400 animate-pulse" : "bg-red-400"
              )} />
              AGENT {isAgentActive ? 'ACTIVE' : 'FROZEN'}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TreasuryCard balance={parseFloat(stats.treasury)} trend={0} />
            <TasksCard count={stats.tasksCompleted} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="liquid-glass-card liquid-glass-shimmer p-5">
              <h3 className="text-lg font-medium text-foreground mb-4">Spend Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="text-foreground font-medium">${Number(spend.totalSpendUsd || 0).toFixed(3)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Budget</span>
                  <span className="text-foreground font-medium">${Number(spend.budget.limitUsd || 0).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="text-foreground font-medium">${Number(spend.budget.remainingUsdEnd || 0).toFixed(3)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Paid Calls</span>
                  <span className="text-foreground font-medium">{spend.paidCalls}</span>
                </div>
                {spend.traceId && (
                  <div className="pt-2 text-xs text-muted-foreground/70">
                    Trace: {spend.traceId}
                  </div>
                )}
              </div>
            </div>

            <div className="liquid-glass-card liquid-glass-shimmer p-5">
              <h3 className="text-lg font-medium text-foreground mb-4">Receipts</h3>
              <div className="space-y-2 max-h-44 overflow-y-auto scrollbar-hidden">
                {spend.receipts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No paid calls in this session yet.</p>
                ) : (
                  spend.receipts.slice(0, 8).map((r, idx) => (
                    <div key={`${r.receiptRef || r.txHash || idx}`} className="text-xs rounded-lg p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground font-medium">{r.agentId}</span>
                        <span className={cn("font-medium", r.success ? "text-emerald-400" : "text-red-400")}>
                          {r.amount || `$${Number(r.amountUsd || 0).toFixed(3)}`}
                        </span>
                      </div>
                      <div className="text-muted-foreground truncate">{r.endpoint}</div>
                      <div className="text-muted-foreground truncate">
                        {r.txHash || r.receiptRef || "Receipt pending"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Activity & Controls Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={canManageAgent ? "lg:col-span-2" : "lg:col-span-3"}>
              <ActivityFeed agentId={selectedAgent?.id} sessionId={activeSessionId} />
            </div>
            {canManageAgent && (
              <AgentControls
                agentId={selectedAgent?.id}
                isActive={isAgentActive}
                onToggle={() => {
                  setIsAgentActive((prev) => {
                    const next = !prev;
                    localStorage.setItem('active_provider_is_frozen', String(!next));
                    return next;
                  });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
