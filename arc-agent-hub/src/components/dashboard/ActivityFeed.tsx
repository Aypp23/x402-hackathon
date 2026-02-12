import { useState, useEffect } from 'react';
import { ArrowDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  type: string;
  timestamp: string;
  action: 'received' | 'sent';
  responseTimeMs: number;
  amount: number;
}

interface ActivityFeedProps {
  agentId?: string | null;
  sessionId?: string | null;
}

export function ActivityFeed({ agentId, sessionId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchActivities = async () => {
      if (!agentId) {
        if (isMounted) setActivities([]);
        return;
      }

      if (isMounted) setLoading(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const params = new URLSearchParams({ agentId, limit: '10' });
        if (sessionId) {
          params.set('sessionId', sessionId);
        }

        const response = await fetch(`${API_BASE_URL}/dashboard/activity?${params.toString()}`, {
          cache: 'no-store'
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch activity (${response.status})`);
        }
        const data = await response.json();
        if (isMounted && data.activities) {
          setActivities(data.activities);
        }
      } catch (error) {
        console.error('Failed to fetch activities:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchActivities();
    // Refresh every 5 seconds
    const interval = setInterval(fetchActivities, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [agentId, sessionId]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="liquid-glass-card liquid-glass-shimmer p-5 h-full">
      <h3 className="text-lg font-medium text-foreground mb-6">Recent Activity</h3>
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {loading && activities.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">Loading...</p>
        ) : activities.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">No queries yet. Start using this agent to see activity.</p>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center justify-between p-3 rounded-xl hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center bg-secondary",
                  "text-emerald-400"
                )}>
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">{activity.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(activity.timestamp)} • {((activity.responseTimeMs || 0) / 1000).toFixed(1)}s response
                  </p>
                </div>
              </div>
              <div className="font-medium text-sm text-emerald-400">
                +${activity.amount.toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
