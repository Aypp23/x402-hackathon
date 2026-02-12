import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { cn } from '@/lib/utils';
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import type { Abi, Address, ReadContractParameters } from 'viem';

interface BalanceCardProps {
  compact?: boolean;
}

const BASE_SEPOLIA = {
  rpcUrl: 'https://sepolia.base.org',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
  usdcDecimals: 6,
} as const;

const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']) as Abi;

export function BalanceCard({ compact = false }: BalanceCardProps) {
  const { address, isConnected } = useWallet();
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');

  const publicClient = useMemo(() => {
    return createPublicClient({
      transport: http(BASE_SEPOLIA.rpcUrl),
    });
  }, []);

  const refreshUsdcBalance = useCallback(async () => {
    if (!address) return;

    try {
      const account = address as Address;
      const params = {
        address: BASE_SEPOLIA.usdcAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account] as const,
      } as unknown as ReadContractParameters<Abi, 'balanceOf', readonly [Address]>;

      const balance = (await publicClient.readContract(params)) as unknown as bigint;
      setUsdcBalance(formatUnits(balance, BASE_SEPOLIA.usdcDecimals));
    } catch {
      setUsdcBalance('0.00');
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (!isConnected || !address) return;
    refreshUsdcBalance();
  }, [address, isConnected, refreshUsdcBalance]);

  if (!isConnected || !address) return null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-3 py-1.5 liquid-glass-button text-sm",
      compact ? "text-xs" : ""
    )}>
      <span className="font-medium">
        $
        {parseFloat(usdcBalance).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
      <span className="text-muted-foreground">USDC</span>
    </div>
  );
}
