import { useState, useEffect, useRef } from 'react';
import { Layout } from '@/components/layout/Layout';
import { ArrowRight, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { sepolia, polygonAmoy, arbitrumSepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { CCTPBridgeCard } from '@/components/bridge/CCTPBridgeCard';

import ethereumIcon from '@/assets/chains/ethereum.svg';
import polygonIcon from '@/assets/chains/polygon.svg';
import arbitrumIcon from '@/assets/chains/arbitrum.svg';
import optimismIcon from '@/assets/chains/optimism.svg';
import baseIcon from '@/assets/chains/base.png';

// Configuration for supported CCTP chains
const chainConfig: Record<string, {
  name: string;
  icon: string;
  chainId: number;
  rpcUrl: string;
  usdcAddress: `0x${string}`;
  tokenMessengerAddress: `0x${string}`;
  messageTransmitterAddress: `0x${string}`;
  domain: number;
  viemChain: any;
  explorerUrl: string;
  attestationWaitSecs: number; // Fast Transfer wait time in seconds
}> = {
  'ethereum': {
    name: 'Ethereum Sepolia',
    icon: ethereumIcon,
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessengerAddress: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    messageTransmitterAddress: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
    domain: 0,
    viemChain: sepolia,
    explorerUrl: 'https://sepolia.etherscan.io/tx/',
    attestationWaitSecs: 30 // Fast Transfer: ~30s
  },
  'polygon': {
    name: 'Polygon Amoy',
    icon: polygonIcon,
    chainId: 80002,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    usdcAddress: '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',
    tokenMessengerAddress: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    messageTransmitterAddress: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
    domain: 7,
    viemChain: polygonAmoy,
    explorerUrl: 'https://amoy.polygonscan.com/tx/',
    attestationWaitSecs: 30 // Fast Transfer: ~30s
  },
  'arbitrum': {
    name: 'Arbitrum Sepolia',
    icon: arbitrumIcon,
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessengerAddress: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    messageTransmitterAddress: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
    domain: 3,
    viemChain: arbitrumSepolia,
    explorerUrl: 'https://sepolia.arbiscan.io/tx/',
    attestationWaitSecs: 30 // Fast Transfer: ~30s
  },
  'optimism': {
    name: 'Optimism Sepolia',
    icon: optimismIcon,
    chainId: 11155420,
    rpcUrl: 'https://sepolia.optimism.io',
    usdcAddress: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    tokenMessengerAddress: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    messageTransmitterAddress: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
    domain: 2,
    viemChain: optimismSepolia,
    explorerUrl: 'https://sepolia-optimistic.etherscan.io/tx/',
    attestationWaitSecs: 30 // Fast Transfer: ~30s
  },
  'base': {
    name: 'Base Sepolia',
    icon: baseIcon,
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessengerAddress: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa',
    messageTransmitterAddress: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
    domain: 6,
    viemChain: baseSepolia,
    explorerUrl: 'https://sepolia.basescan.org/tx/',
    attestationWaitSecs: 30 // Fast Transfer: ~30s
  }
};

// CCTP Attestation API - used for polling deposit status
const CCTP_API_BASE = 'https://iris-api-sandbox.circle.com';

const chains = Object.entries(chainConfig).map(([id, config]) => ({ id, ...config }));

const recentDepositsKey = (address: string) => `recentDeposits_${address}`;

export default function Deposit() {
  const { isConnected, address } = useWallet();
  const [selectedChain, setSelectedChain] = useState(chains[0]);
  const [amount, setAmount] = useState('');
  const [chainBalances, setChainBalances] = useState<Record<string, string>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentDeposits, setRecentDeposits] = useState<{ txHash: string; chain: string; chainDomain?: number; amount: string; time: string; status: string; message?: string; attestation?: string }[]>([]);

  // Bridge modal state
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [resumeTxHash, setResumeTxHash] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (address) {
      const saved = localStorage.getItem(recentDepositsKey(address));
      if (saved) {
        setRecentDeposits(JSON.parse(saved));
      } else {
        setRecentDeposits([]);
      }
    }
  }, [address]);

  const addDeposit = (deposit: { txHash: string; chain: string; chainDomain?: number; amount: string; time: string; status: string }) => {
    if (!address) return;
    const exists = recentDeposits.some(d => d.txHash === deposit.txHash);
    if (exists) {
      updateDepositStatus(deposit.txHash, deposit.status);
      return;
    }
    const newDeposits = [deposit, ...recentDeposits];
    setRecentDeposits(newDeposits);
    localStorage.setItem(recentDepositsKey(address), JSON.stringify(newDeposits));
  };



  const recentDepositsRef = useRef(recentDeposits);
  useEffect(() => {
    recentDepositsRef.current = recentDeposits;
  }, [recentDeposits]);

  // Update deposit status
  const updateDepositStatus = (txHash: string, status: string, message?: string, attestation?: string) => {
    if (!address) return;
    setRecentDeposits(prev => {
      const updated = prev.map(d =>
        d.txHash === txHash ? { ...d, status, ...(message && { message }), ...(attestation && { attestation }) } : d
      );
      localStorage.setItem(recentDepositsKey(address), JSON.stringify(updated));
      return updated;
    });
  };

  // Poll attestation status for pending deposits
  useEffect(() => {
    if (!address || recentDeposits.length === 0) return;

    // Arc Testnet MessageTransmitter address
    const ARC_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
    const ARC_RPC = 'https://rpc.testnet.arc.network';

    const checkPendingDeposits = async () => {
      // Check both waiting and ready-to-mint deposits (not already complete)
      // Use ref to avoid stale closures
      const pendingDeposits = recentDepositsRef.current.filter(d =>
        (d.status.toLowerCase().includes('waiting') || d.status.toLowerCase() === 'processing' || d.status.toLowerCase().includes('ready'))
        && d.status.toLowerCase() !== 'complete'
      );

      if (pendingDeposits.length === 0) return;

      console.log(`[CCTP Poll] Checking ${pendingDeposits.length} pending deposits...`);

      // Create Arc client for checking minted status
      const arcClient = createPublicClient({
        transport: http(ARC_RPC)
      });

      for (const deposit of pendingDeposits) {
        // Get chainDomain from deposit or look it up from chain name
        let domain = deposit.chainDomain;
        if (domain === undefined) {
          const chain = chains.find(c => c.name === deposit.chain);
          domain = chain?.domain;
        }

        if (domain === undefined) {
          console.log(`[CCTP Poll] Skipping ${deposit.txHash}: no domain found for chain "${deposit.chain}"`);
          continue;
        }

        try {
          const url = `${CCTP_API_BASE}/v2/messages/${domain}?transactionHash=${deposit.txHash}`;
          console.log(`[CCTP Poll] Fetching: ${url}`);

          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            console.log(`[CCTP Poll] Response for ${deposit.txHash}:`, data);

            if (data.messages?.[0]?.status === 'complete') {
              const msg = data.messages[0];

              // Check if already minted on Arc Testnet by checking usedNonces
              try {
                // The message contains a nonce that we can use to check if it's been used
                // We'll check by calling usedNonces(bytes32 sourceAndNonce) on MessageTransmitter
                // sourceAndNonce = keccak256(abi.encodePacked(sourceDomain, nonce))
                const messageHash = msg.messageHash;

                if (messageHash) {
                  // Check if this message nonce was used (meaning it was already minted)
                  const usedNonce = await arcClient.readContract({
                    address: ARC_MESSAGE_TRANSMITTER,
                    abi: parseAbi(['function usedNonces(bytes32) view returns (uint256)']),
                    functionName: 'usedNonces',
                    args: [messageHash as `0x${string}`],
                  } as any) as bigint;

                  console.log(`[CCTP Poll] Message ${deposit.txHash} usedNonce result:`, usedNonce);

                  if (usedNonce > 0n) {
                    // Already minted!
                    console.log(`[CCTP Poll] Deposit ${deposit.txHash} was ALREADY MINTED! Marking complete.`);
                    updateDepositStatus(deposit.txHash, 'Complete', msg.message, msg.attestation);
                    continue;
                  }
                }
              } catch (nonceErr) {
                console.log(`[CCTP Poll] Could not check nonce for ${deposit.txHash}:`, nonceErr);
              }

              // Attestation is ready but not yet minted
              console.log(`[CCTP Poll] Deposit ${deposit.txHash} attestation ready, not yet minted`);
              if (!deposit.status.toLowerCase().includes('ready')) {
                updateDepositStatus(deposit.txHash, 'Ready to mint', msg.message, msg.attestation);
              }
            } else {
              console.log(`[CCTP Poll] Deposit ${deposit.txHash} status: ${data.messages?.[0]?.status || 'no messages'}`);
            }
          } else {
            console.log(`[CCTP Poll] API error for ${deposit.txHash}:`, response.status);
          }
        } catch (e) {
          console.error('[CCTP Poll] Failed to check deposit:', e);
        }
      }
    };

    // Check immediately and then every 15 seconds
    checkPendingDeposits();
    const interval = setInterval(checkPendingDeposits, 15000);
    return () => clearInterval(interval);
  }, [address]);

  useEffect(() => {
    const fetchBalances = async () => {
      if (!address) return;
      setIsRefreshing(true);
      const balances: Record<string, string> = {};

      await Promise.all(chains.map(async (chain) => {
        try {
          const client = createPublicClient({
            chain: chain.viemChain,
            transport: http(chain.rpcUrl)
          });

          const balance = await client.readContract({
            address: chain.usdcAddress,
            abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
          } as any) as bigint;

          balances[chain.id] = formatUnits(balance, 6);
        } catch (e) {
          console.error(`Failed to fetch balance for ${chain.id}:`, e);
          balances[chain.id] = '0.00';
        }
      }));

      setChainBalances(balances);
      setIsRefreshing(false);
    };

    if (address) {
      fetchBalances();
      // Auto-refresh balances every 30 seconds
      const interval = setInterval(fetchBalances, 30000);
      return () => clearInterval(interval);
    }
  }, [address]);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address || '');
    toast.success('Address copied to clipboard');
  };

  // Start the bridge process - just show the modal
  const handleDeposit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!address || !(window as any).ethereum) {
      toast.error("Please connect your wallet");
      return;
    }

    // The CCTPBridgeCard handles all the CCTP logic
    setResumeTxHash(undefined);
    setShowBridgeModal(true);
  };

  const handleResume = (deposit: { txHash: string; amount: string; chain: string; status: string }) => {
    // Only resume if not complete
    if (deposit.status.toLowerCase() === 'complete') return;

    // Set amount and chain from deposit to ensure formatted correctly
    setAmount(deposit.amount);
    const chain = chains.find(c => c.name === deposit.chain);
    if (chain) setSelectedChain(chain);

    setResumeTxHash(deposit.txHash);
    setShowBridgeModal(true);
  };

  return (
    <Layout>
      {showBridgeModal && amount && (
        <CCTPBridgeCard
          amount={amount}
          sourceChain={selectedChain}
          onClose={() => {
            setShowBridgeModal(false);
            setAmount('');
            setResumeTxHash(undefined);
          }}
          onComplete={(burnTx) => {
            updateDepositStatus(burnTx, 'Complete');
            setShowBridgeModal(false);
            setAmount('');
            setResumeTxHash(undefined);
          }}
          onProgress={(burnTx, step) => {
            if (step === 'waiting') {
              addDeposit({
                txHash: burnTx,
                chain: selectedChain.name,
                chainDomain: selectedChain.domain,
                amount: amount,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'Waiting'
              });
            } else if (step === 'ready') {
              updateDepositStatus(burnTx, 'Ready to mint');
            }
          }}
          resumeTxHash={resumeTxHash}
        />
      )}
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        <div className="space-y-6">
          {/* Header */}
          <div className="pb-3">
            <h1 className="text-2xl font-medium text-foreground tracking-tight">Deposit USDC</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Fund your agent wallet from any supported chain
            </p>
          </div>

          {!isConnected ? (
            <div className="liquid-glass-card p-8 text-center">
              <p className="text-sm text-muted-foreground">Connect your wallet to deposit funds</p>
            </div>
          ) : (
            <div className="grid gap-6 lg:gap-8 lg:grid-cols-2">
              {/* Deposit Form */}
              <div className="liquid-glass-card liquid-glass-shimmer p-5">
                <h2 className="text-lg font-medium text-foreground mb-4">Select Chain</h2>

                <div className="grid grid-cols-2 gap-2 mb-5">
                  {chains.map((chain) => (
                    <button
                      key={chain.id}
                      onClick={() => setSelectedChain(chain)}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all",
                        selectedChain.id === chain.id
                          ? 'liquid-glass-primary text-foreground'
                          : 'liquid-glass-button text-muted-foreground'
                      )}
                    >
                      <img src={chain.icon} alt={chain.name} className="w-5 h-5" />
                      <span className="font-medium truncate">{chain.name}</span>
                      <span className="ml-auto text-xs opacity-70 whitespace-nowrap font-mono">
                        {chainBalances[chain.id]
                          ? `$${parseFloat(chainBalances[chain.id]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : isRefreshing ? '...' : '$0.00'}
                      </span>
                      {selectedChain.id === chain.id && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="mb-5">
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Amount
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent border border-border/30 rounded-xl px-4 py-3 text-base font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                      USDC
                    </span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {[10, 25, 50, 100].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setAmount(preset.toString())}
                        className="px-3 py-1.5 text-xs font-medium liquid-glass-button text-muted-foreground hover:text-foreground"
                      >
                        ${preset}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleDeposit}
                  disabled={showBridgeModal}
                  className={cn(
                    "w-full liquid-glass-primary py-3 rounded-full text-sm font-medium text-primary-foreground flex items-center justify-center gap-2",
                    showBridgeModal && "opacity-70 cursor-not-allowed"
                  )}
                >
                  {showBridgeModal ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Bridging...
                    </>
                  ) : (
                    <>
                      Bridge via {selectedChain.name}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className="text-xs text-muted-foreground/70 mt-4 text-center">
                  Powered by Circle CCTP • Fast Transfer ~{selectedChain.attestationWaitSecs}s
                </p>
              </div>

              {/* Deposit Address & History */}
              <div className="space-y-4">
                <div className="liquid-glass-card liquid-glass-shimmer p-5">
                  <h2 className="text-lg font-medium text-foreground mb-4">Your Deposit Address</h2>
                  <div className="bg-secondary rounded-lg p-4 border border-border/30">
                    <p className="text-xs text-muted-foreground mb-2">
                      Send USDC directly to this address on {selectedChain.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono text-foreground/80 break-all">
                        {address}
                      </code>
                      <button
                        onClick={handleCopyAddress}
                        className="p-2 hover:bg-secondary/80 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Faucet Button */}
                  <div className="mt-4">
                    <button
                      disabled={(() => {
                        if (!address) return true;
                        const lastRequest = localStorage.getItem(`faucet_${address}`);
                        if (lastRequest) {
                          const timeSince = Date.now() - parseInt(lastRequest);
                          return timeSince < 24 * 60 * 60 * 1000;
                        }
                        return false;
                      })()}
                      onClick={async () => {
                        try {
                          const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
                          toast.info("Requesting funds from Circle Faucet...");
                          const res = await fetch(`${API_BASE_URL}/faucet`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ address })
                          });
                          const data = await res.json();
                          if (data.success) {
                            toast.success("Funds requested! Check balance in ~10s");
                            localStorage.setItem(`faucet_${address}`, Date.now().toString());
                            window.location.reload();
                          } else {
                            if (res.status === 429 || (data.error && data.error.includes("429"))) {
                              toast.error("Daily limit reached. Try again in 24h.");
                              localStorage.setItem(`faucet_${address}`, Date.now().toString());
                              window.location.reload();
                              return;
                            }
                            toast.error("Faucet failed: " + (data.error || "Unknown error"));
                          }
                        } catch (e) {
                          toast.error("Network error: Is backend running?");
                        }
                      }}
                      className={cn(
                        "w-full py-3 rounded-full text-sm font-medium flex items-center justify-center gap-2 transition-all",
                        (() => {
                          if (!address) return "bg-muted text-muted-foreground cursor-not-allowed";
                          const lastRequest = localStorage.getItem(`faucet_${address}`);
                          if (lastRequest && (Date.now() - parseInt(lastRequest) < 24 * 60 * 60 * 1000)) {
                            return "bg-secondary/50 text-muted-foreground cursor-not-allowed border border-border/10";
                          }
                          return "liquid-glass-primary text-primary-foreground hover:opacity-90";
                        })()
                      )}
                    >
                      {(() => {
                        if (!address) return "Connect Wallet First";
                        const lastRequest = localStorage.getItem(`faucet_${address}`);
                        if (lastRequest && (Date.now() - parseInt(lastRequest) < 24 * 60 * 60 * 1000)) {
                          return "Faucet Limit Reached (24h)";
                        }
                        return "Request Testnet Funds";
                      })()}
                    </button>
                    {address && localStorage.getItem(`faucet_${address}`) && (Date.now() - parseInt(localStorage.getItem(`faucet_${address}`)!) < 24 * 60 * 60 * 1000) && (
                      <p className="text-[10px] text-muted-foreground mt-2 text-center">
                        Next request available in ~{Math.ceil((24 * 60 * 60 * 1000 - (Date.now() - parseInt(localStorage.getItem(`faucet_${address}`)!))) / (1000 * 60 * 60))}h
                      </p>
                    )}
                  </div>
                </div>

                <div className="liquid-glass-card liquid-glass-shimmer p-5">
                  <h2 className="text-lg font-medium text-foreground mb-4">Recent Deposits</h2>
                  <div className="max-h-[500px] overflow-y-auto space-y-0 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                    {recentDeposits.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No recent deposits</p>
                    ) : (
                      recentDeposits.map((deposit, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-3 border-b border-border/30 last:border-0 last:pb-0 first:pt-0"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">${deposit.amount} USDC</p>
                            <p className="text-xs text-muted-foreground">
                              {deposit.chain} · {deposit.time}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-xs font-medium px-2 py-1 rounded-md capitalize",
                                deposit.status.toLowerCase() === 'complete' ? "bg-green-500/10 text-green-500" :
                                  deposit.status.toLowerCase().includes('ready') ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 cursor-pointer" :
                                    "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 cursor-pointer"
                              )}
                              onClick={() => handleResume(deposit)}
                            >
                              {deposit.status}
                              {deposit.status.toLowerCase() !== 'complete' && <RefreshCw className="w-3 h-3 ml-1 inline-block" />}
                            </span>
                            <a
                              href={chains.find(c => c.name === deposit.chain)?.explorerUrl + deposit.txHash}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground/50 hover:text-muted-foreground"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        </div>
                      ))
                    )}
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
