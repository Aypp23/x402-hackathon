import { useCallback } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Copy, ExternalLink } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from 'sonner';

const BASE_SEPOLIA = {
  chainId: 84532,
  rpcUrl: 'https://sepolia.base.org',
  explorerUrl: 'https://sepolia.basescan.org',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
} as const;

export default function Deposit() {
  const { isConnected } = useWallet();

  const handleCopyText = useCallback(async (text: string, successMessage: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  }, []);

  return (
    <Layout>
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="space-y-6">
          <div className="pb-3">
            <h1 className="text-2xl font-medium text-foreground tracking-tight">Get test USDC</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Fund your wallet on Base Sepolia</p>
          </div>

          {!isConnected ? (
            <div className="liquid-glass-card p-8 text-center">
              <p className="text-sm text-muted-foreground">Connect your wallet to continue</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto">
              <div className="liquid-glass-card liquid-glass-shimmer p-5">
                <h2 className="text-lg font-medium text-foreground mb-4">Faucet</h2>

                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>1) Open the Circle Faucet and request USDC on Base Sepolia</p>
                  <p>2) Paste your wallet address and submit</p>
                  <p>3) Refresh your wallet to confirm it arrived</p>
                </div>

                <div className="mt-4">
                  <a
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full liquid-glass-primary py-3 rounded-full text-sm font-medium text-primary-foreground flex items-center justify-center gap-2"
                  >
                    Open Circle Faucet
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>

                <div className="bg-secondary rounded-lg p-4 border border-border/30 mt-4">
                  <p className="text-xs text-muted-foreground mb-2">Base Sepolia USDC contract</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono text-foreground/80 break-all">
                      {BASE_SEPOLIA.usdcAddress}
                    </code>
                    <button
                      onClick={() => handleCopyText(BASE_SEPOLIA.usdcAddress, 'USDC contract copied')}
                      className="p-2 hover:bg-secondary/80 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <a
                      href={`${BASE_SEPOLIA.explorerUrl}/token/${BASE_SEPOLIA.usdcAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      View on BaseScan
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="font-mono text-muted-foreground/70">{BASE_SEPOLIA.chainId}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
