import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Search, Star, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useWallet } from '@/contexts/WalletContext';

// Admin wallet that can see Connect buttons (from env)
const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS || '';

const categories = ['All', 'DeFi', 'NFT', 'Analytics', 'Trading'];

interface Provider {
  id: string;
  name: string;
  description: string;
  category: string;
  rating: number;
  reviews: number;
  price: number;
  responseTime: string;
  pricingModel: string;
  paidTools: boolean;
  verified: boolean;
  popular: boolean;
  isFrozen: boolean;
}

// Rich metadata to merge with backend data
const PROVIDER_METADATA = {
  descriptions: [
    "Specialized in analyzing market trends and on-chain data patterns.",
    "Expert in DeFi protocol interactions and yield optimization strategies.",
    "Focused on NFT floor price tracking and rarity analysis.",
    "High-speed trading execution and arbitrage detection."
  ],
  categories: ['Analytics', 'DeFi', 'NFT', 'Trading']
};

export default function Providers() {
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  const [connectedProviderId, setConnectedProviderId] = useState<string | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);

  const connectProvider = (provider: Provider) => {
    localStorage.setItem('active_provider_id', provider.id);
    localStorage.setItem('active_provider_name', provider.name);
    localStorage.setItem('active_provider_is_frozen', String(provider.isFrozen));
    setConnectedProviderId(provider.id);
    navigate('/dashboard', {
      state: {
        providerId: provider.id,
        providerName: provider.name,
        providerIsFrozen: provider.isFrozen,
      }
    });
  };

  useEffect(() => {
    const stored = localStorage.getItem('active_provider_id');
    if (stored) setConnectedProviderId(stored);
  }, []);

  useEffect(() => {
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    let isMounted = true;

    const fetchProviders = async (silent = false) => {
      try {
        if (!silent && isMounted) {
          setLoading(true);
        }

        // Fetch providers with per-agent stats
        const providersRes = await fetch(`${API_BASE_URL}/providers`);
        const providersData = await providersRes.json();

        if (providersData.providers && isMounted) {
          const mappedProviders = providersData.providers.map((p: any, index: number) => ({
            id: p.agentId,
            name: p.name,
            // Use API description/category if available, otherwise fallback
            description: p.description || PROVIDER_METADATA.descriptions[index % PROVIDER_METADATA.descriptions.length],
            category: p.category || PROVIDER_METADATA.categories[index % PROVIDER_METADATA.categories.length],
            // Use per-agent stats from API (now included in /providers response)
            rating: p.rating || 0,
            reviews: p.totalRatings || 0,
            price: parseFloat(p.price),
            responseTime: p.avgResponseTime || '—',
            pricingModel: p.pricingModel || 'per-call-fixed',
            paidTools: Boolean(p.paidTools),
            verified: true,
            popular: index === 0,
            isFrozen: Boolean(p.isFrozen),
          }));
          setProviders(mappedProviders);
        }
      } catch (error) {
        console.error('Failed to fetch providers:', error);
        if (!silent) {
          toast.error("Failed to load providers");
        }
      } finally {
        if (!silent && isMounted) {
          setLoading(false);
        }
      }
    };


    void fetchProviders();
    const refreshInterval = window.setInterval(() => {
      void fetchProviders(true);
    }, 10000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
    };
  }, []);

  const filteredProviders = providers
    .filter((provider) => {
      const matchesSearch = provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        provider.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || provider.category === selectedCategory;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => Number(a.isFrozen) - Number(b.isFrozen));

  return (
    <Layout>
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="space-y-6 max-w-5xl ml-auto">
          {/* Header */}
          <div className="pb-3">
            <h1 className="text-2xl font-medium text-foreground tracking-tight">AI Providers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Discover and connect specialized AI agents
            </p>
          </div>

          {/* Search and Category Tabs */}
          <div className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search providers..."
                className="w-full liquid-glass-button pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/50"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hidden">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                    selectedCategory === category
                      ? 'liquid-glass-primary'
                      : 'liquid-glass-button text-muted-foreground hover:text-foreground'
                  )}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Providers Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredProviders.map((provider) => (
              <div
                key={provider.id}
                onClick={() => {
                  if (provider.isFrozen) {
                    connectProvider(provider);
                    return;
                  }
                  setExpandedProviderId(expandedProviderId === provider.id ? null : provider.id);
                }}
                className={cn(
                  "liquid-glass-card liquid-glass-shimmer p-5 cursor-pointer transition-all duration-200 relative overflow-hidden",
                  provider.isFrozen && "border-red-900/40 bg-red-950/5"
                )}
              >
                {provider.isFrozen && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <span className="-rotate-12 text-4xl font-bold tracking-[0.35em] text-red-400/85 drop-shadow-[0_0_14px_rgba(248,113,113,0.55)] select-none">
                      FROZEN
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-3">
                  {provider.popular && (
                    <span className="text-xs font-medium px-2 py-1 rounded-md bg-primary/10 text-primary/70">
                      Popular
                    </span>
                  )}
                  {provider.isFrozen && (
                    <span className="text-xs font-medium px-2 py-1 rounded-md bg-red-500/15 text-red-300">
                      Frozen
                    </span>
                  )}
                  {provider.paidTools && (
                    <span className="text-xs font-medium px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300">
                      Paid tools
                    </span>
                  )}
                  <span className="text-xs font-medium px-2 py-1 rounded-md bg-secondary text-muted-foreground ml-auto">
                    {provider.category}
                  </span>
                </div>

                <h3 className="text-base font-medium text-foreground mb-1.5 group-hover:text-primary transition-colors">
                  {provider.name}
                </h3>
                <p className={cn(
                  "text-sm text-muted-foreground mb-4 leading-relaxed transition-all duration-200",
                  expandedProviderId === provider.id ? "" : "line-clamp-2"
                )}>
                  {provider.description}
                </p>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <div className="flex items-center gap-1.5">
                    <Star className="w-4 h-4 text-muted-foreground/70" />
                    <span className="text-foreground font-medium">{provider.rating}</span>
                    <span className="text-muted-foreground/50">({provider.reviews})</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground/50">
                    <Clock className="w-4 h-4" />
                    <span>{provider.responseTime}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-base font-medium text-foreground">${provider.price}</span>
                      <span className="text-sm text-muted-foreground/50">/query</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60">
                      Pricing model: {provider.pricingModel === 'per-call-fixed' ? 'Per-call fixed' : provider.pricingModel}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      connectProvider(provider);
                    }}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-medium transition-all duration-300",
                      provider.isFrozen
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                        : "",
                      !provider.isFrozen && (
                      connectedProviderId === provider.id
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                        : "liquid-glass-primary text-primary-foreground hover:opacity-90"
                      )
                    )}
                  >
                    {provider.isFrozen ? 'Manage' : (connectedProviderId === provider.id ? 'Connected' : 'Connect')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredProviders.length === 0 && !loading && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground/70">No providers found matching your criteria</p>
            </div>
          )}

          {loading && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground/70 animate-pulse">Loading providers...</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
