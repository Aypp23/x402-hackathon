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
}

const Dashboard = () => {
  const { address } = useWallet();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  const [isOwner, setIsOwner] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string; wallet?: string } | null>(null);
  const [stats, setStats] = useState({
    treasury: "0.00",
    tasksCompleted: 0,
    rating: 0,
    totalRatings: 0,
    avgResponseTime: "0s"
  });

  // Load selected agent from navigation state or localStorage
  useEffect(() => {
    if (locationState?.providerId && locationState?.providerName) {
      setSelectedAgent({ id: locationState.providerId, name: locationState.providerName });
    } else {
      const storedAgentId = localStorage.getItem('active_provider_id');
      const storedAgentName = localStorage.getItem('active_provider_name');
      if (storedAgentId) {
        setSelectedAgent({ id: storedAgentId, name: storedAgentName || '' });
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

        const response = await fetch(url);
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

        if (data.isFrozen !== undefined) setIsAgentActive(!data.isFrozen);

        // Check ownership
        if (data.address && address) {
          setIsOwner(data.address.toLowerCase() === address.toLowerCase());
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
                    href={`https://testnet.arcscan.app/address/${selectedAgent.wallet}`}
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

          {/* Activity & Controls Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <ActivityFeed agentId={selectedAgent?.id} />
            </div>
            {isOwner && (
              <AgentControls
                isActive={isAgentActive}
                onToggle={() => setIsAgentActive(!isAgentActive)}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
