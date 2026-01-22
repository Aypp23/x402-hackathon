import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useAccount, useBalance, useDisconnect, useSignMessage } from 'wagmi';
import { useModal } from 'connectkit';
import { formatUnits } from 'viem';
import { arcTestnet } from '@/lib/wagmiConfig';
import { toast } from 'sonner';

interface WalletContextType {
  isConnected: boolean;
  isVerified: boolean;
  address: string | null;
  balance: number;
  connect: () => void;
  disconnect: () => void;
  deductBalance: (amount: number) => boolean;
  refreshBalance: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { setOpen } = useModal();
  const { signMessageAsync } = useSignMessage();

  const [isVerified, setIsVerified] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Fetch balance from Arc Testnet
  const { data: balanceData, refetch: refetchBalance } = useBalance({
    address: wagmiAddress,
    chainId: arcTestnet.id,
  });

  const [localBalance, setLocalBalance] = useState(0);

  // Sync balance from wagmi
  useEffect(() => {
    if (balanceData) {
      const bal = parseFloat(formatUnits(balanceData.value, balanceData.decimals));
      setLocalBalance(bal);
    }
  }, [balanceData]);

  // Verify wallet ownership by signing a message
  const verifyOwnership = useCallback(async () => {
    if (!wagmiAddress || pendingVerification) return;

    setPendingVerification(true);

    const message = `Sign this message to verify you own this wallet.\n\nWallet: ${wagmiAddress}\nTimestamp: ${Date.now()}`;

    try {
      const signature = await signMessageAsync({ account: wagmiAddress, message });

      if (signature) {
        setIsVerified(true);
        localStorage.setItem('verifiedWallet', JSON.stringify({
          address: wagmiAddress,
          verifiedAt: Date.now()
        }));
        toast.success('Wallet verified successfully!');
      }
    } catch (error: any) {
      console.error('Signature rejected:', error);
      toast.error('Signature rejected. Please sign to verify ownership.');
      // Disconnect if user rejects signature
      wagmiDisconnect();
      setIsVerified(false);
    } finally {
      setPendingVerification(false);
    }
  }, [wagmiAddress, signMessageAsync, wagmiDisconnect, pendingVerification]);

  useEffect(() => {
    if (wagmiConnected && wagmiAddress && !isVerified && !pendingVerification && !isDisconnecting) {
      // Check if we have a recent verification in localStorage
      const stored = localStorage.getItem('verifiedWallet');
      if (stored) {
        const parsed = JSON.parse(stored);
        // If same address and verified within last 24 hours, skip re-verification
        if (parsed.address?.toLowerCase() === wagmiAddress.toLowerCase() &&
          Date.now() - parsed.verifiedAt < 24 * 60 * 60 * 1000) {
          setIsVerified(true);
          return;
        }
      }
      // Request new verification
      verifyOwnership();
    }
  }, [wagmiConnected, wagmiAddress, isVerified, pendingVerification, isDisconnecting, verifyOwnership]);

  // Connect opens the ConnectKit modal
  const connect = useCallback(() => {
    setOpen(true);
  }, [setOpen]);

  // Disconnect using wagmi
  const disconnect = useCallback(() => {
    setIsDisconnecting(true);
    wagmiDisconnect();
    setLocalBalance(0);
    setIsVerified(false);
    localStorage.removeItem('connectedWallet');
    localStorage.removeItem('verifiedWallet');
    // Reset after a short delay to allow disconnect to complete
    setTimeout(() => setIsDisconnecting(false), 500);
  }, [wagmiDisconnect]);

  // Refresh balance
  const refreshBalance = useCallback(() => {
    refetchBalance();
  }, [refetchBalance]);

  // Optimistic balance deduction for UI responsiveness
  const deductBalance = useCallback((amount: number): boolean => {
    if (localBalance >= amount) {
      const newBalance = Math.round((localBalance - amount) * 100) / 100;
      setLocalBalance(newBalance);
      return true;
    }
    return false;
  }, [localBalance]);

  // Persist wallet info to localStorage for session recovery
  useEffect(() => {
    if (wagmiConnected && wagmiAddress && isVerified) {
      localStorage.setItem('connectedWallet', JSON.stringify({
        address: wagmiAddress,
        balance: localBalance
      }));
    }
  }, [wagmiConnected, wagmiAddress, localBalance, isVerified]);

  return (
    <WalletContext.Provider value={{
      isConnected: wagmiConnected && isVerified,
      isVerified,
      address: wagmiAddress ?? null,
      balance: localBalance,
      connect,
      disconnect,
      deductBalance,
      refreshBalance
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
