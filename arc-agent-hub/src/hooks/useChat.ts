import { useState, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useChatContext, Message } from '@/contexts/ChatContext';
import { toast } from 'sonner';
import { encodeFunctionData, parseUnits } from 'viem';
import { PAYMENT_TOKEN, PROVIDER_AGENT_ADDRESS } from '@/contracts/escrow';

export interface ImageData {
  base64: string;
  mimeType: string;
}

const COST_PER_MESSAGE = 0.03;
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function useChat() {
  const { messages, setMessages, clearChat, currentSessionId, createNewSession, saveMessageToDb } = useChatContext();
  const [isTyping, setIsTyping] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const { isConnected, address, refreshBalance } = useWallet();

  const sendMessage = useCallback(async (content: string, imageData?: ImageData) => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet first');
      return;
    }

    // Check if MetaMask is available
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      toast.error('MetaMask is required for transactions');
      return;
    }

    // Avoid charging user if backend cannot be reached.
    const healthController = new AbortController();
    const healthTimeout = window.setTimeout(() => healthController.abort(), 5000);
    try {
      const healthRes = await fetch(`${API_BASE_URL}/health`, { signal: healthController.signal });
      if (!healthRes.ok) {
        toast.error(`Backend unavailable at ${API_BASE_URL} (HTTP ${healthRes.status}).`);
        return;
      }
    } catch {
      toast.error(`Cannot reach backend at ${API_BASE_URL}. Check VITE_API_URL and backend server.`);
      return;
    } finally {
      window.clearTimeout(healthTimeout);
    }

    // Add user message immediately (with image preview if attached)
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: content || (imageData ? '[Image attached]' : ''),
      isUser: true,
      timestamp: new Date(),
      imagePreview: imageData ? `data:${imageData.mimeType};base64,${imageData.base64}` : undefined,
    };
    setMessages(prev => [...prev, userMessage]);

    // Create session if none exists (don't clear messages since we already added user message)
    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      activeSessionId = await createNewSession({ clearMessages: false });
      if (!activeSessionId) {
        toast.warning('Chat history is unavailable. Continuing without saving this conversation.');
      }
    }

    // Step 1: Send USDC payment transaction
    setIsPaying(true);
    toast.info(`Please sign the transaction to pay ${COST_PER_MESSAGE.toFixed(2)} ${PAYMENT_TOKEN.symbol}`);

    let txHash: string;

    try {
      const chainIdHex = `0x${PAYMENT_TOKEN.chainId.toString(16)}`;

      // Ensure user is on Base Sepolia for query payments.
      try {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchError: any) {
        // Chain not added, add it
        if (switchError.code === 4902) {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainIdHex,
              chainName: 'Base Sepolia',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: [PAYMENT_TOKEN.rpcUrl],
              blockExplorerUrls: [PAYMENT_TOKEN.explorerUrl],
            }],
          });
        }
      }

      const transferData = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'transfer',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
          },
        ],
        functionName: 'transfer',
        args: [PROVIDER_AGENT_ADDRESS, parseUnits(COST_PER_MESSAGE.toString(), PAYMENT_TOKEN.decimals)],
      });

      txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: PAYMENT_TOKEN.address,
          value: '0x0',
          data: transferData,
        }],
      });

      toast.success(`${PAYMENT_TOKEN.symbol} payment confirmed. Processing your query...`);
    } catch (error: any) {
      console.error('Payment error:', error);
      setIsPaying(false);

      // User rejected the transaction
      if (error.code === 4001) {
        toast.error('Transaction cancelled');
        // Remove the user message since they cancelled
        setMessages(prev => prev.filter(m => m.id !== userMessage.id));
        return;
      }

      toast.error(`Payment failed: ${error.message || 'Unknown error'}`);
      // Add error message
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        content: `Payment failed: ${error.message}. Please try again.`,
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    } finally {
      setIsPaying(false);
    }

    // Step 2: Send query to backend (now that payment is confirmed)
    setIsTyping(true);

    try {
      // Build conversation history for context (exclude images to save bandwidth)
      const conversationHistory = messages.map(m => ({
        role: m.isUser ? 'user' : 'model',
        content: m.content,
      }));

      const response = await fetch(`${API_BASE_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: content,
          txHash, // Include the transaction hash for verification
          userAddress: address,
          imageData: imageData ? { base64: imageData.base64, mimeType: imageData.mimeType } : undefined,
          conversationHistory, // Pass previous messages for context
          sessionId: activeSessionId,
          budgetUsd: (() => {
            const params = new URLSearchParams(window.location.search);
            const raw = params.get('budgetUsd') || params.get('budget');
            if (!raw) return undefined;
            const value = Number(raw);
            return Number.isFinite(value) ? value : undefined;
          })(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Add AI response
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        content: data.response,
        isUser: false,
        timestamp: new Date(),
        escrowId: data.escrowId,
        txHash,
        agentsUsed: data.agentsUsed,
      };

      setMessages(prev => [...prev, aiMessage]);

      // Save both messages to database
      if (activeSessionId) {
        await saveMessageToDb(userMessage, activeSessionId);
        await saveMessageToDb(aiMessage, activeSessionId);
      }

      toast.success(`Query completed • Paid $${COST_PER_MESSAGE}`);

      // Refresh balance from blockchain
      if (refreshBalance) {
        refreshBalance();
      }
    } catch (error) {
      console.error('Chat error:', error);
      const rawMessage = (error as Error).message || 'Unknown error';
      const message = /Failed to fetch|NetworkError|Load failed/i.test(rawMessage)
        ? `Cannot reach backend at ${API_BASE_URL}. Check VITE_API_URL and backend server.`
        : rawMessage;
      toast.error(`Error: ${message}`);

      // Add error message (but they already paid)
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        content: `Sorry, I encountered an error after your payment: ${message}. Your payment of $${COST_PER_MESSAGE} was recorded (tx: ${txHash?.slice(0, 10)}...)`,
        isUser: false,
        timestamp: new Date(),
        txHash,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  }, [isConnected, address, refreshBalance, messages, setMessages, currentSessionId, createNewSession, saveMessageToDb]);

  return { messages, isTyping, isPaying, sendMessage, clearChat };
}

// Re-export Message type
export type { Message } from '@/contexts/ChatContext';
