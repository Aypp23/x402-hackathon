import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { toast } from 'sonner';
import { useWallet } from './WalletContext';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Message {
    id: string;
    content: string;
    isUser: boolean;
    timestamp: Date;
    escrowId?: string;
    txHash?: string;
    imagePreview?: string;
    agentsUsed?: string[];
}

export interface ChatSession {
    id: string;
    wallet_address: string;
    title: string;
    created_at: string;
    updated_at: string;
}

interface ChatContextType {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    clearChat: () => void;
    sessions: ChatSession[];
    currentSessionId: string | null;
    loadSession: (sessionId: string) => Promise<void>;
    createNewSession: (options?: { clearMessages?: boolean }) => Promise<string | null>;
    deleteSession: (sessionId: string) => Promise<void>;
    refreshSessions: () => Promise<void>;
    saveMessageToDb: (message: Message, sessionIdOverride?: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'x402-chat-current-session';

export function ChatProvider({ children }: { children: ReactNode }) {
    const { address, isConnected } = useWallet();
    const [messages, setMessages] = useState<Message[]>([]);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    // Load sessions when wallet connects
    useEffect(() => {
        if (isConnected && address) {
            refreshSessions();
            // Restore last session if saved
            const savedSessionId = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedSessionId) {
                loadSession(savedSessionId);
            }
        } else {
            setSessions([]);
            setMessages([]);
            setCurrentSessionId(null);
        }
    }, [isConnected, address]);

    // Save current session ID to localStorage
    useEffect(() => {
        if (currentSessionId) {
            localStorage.setItem(LOCAL_STORAGE_KEY, currentSessionId);
        }
    }, [currentSessionId]);

    const refreshSessions = useCallback(async () => {
        if (!address) return;

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions?wallet=${address}`);
            const data = await res.json();
            if (data.success) {
                setSessions(data.sessions);
            }
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
    }, [address]);

    const loadSession = useCallback(async (sessionId: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages`);
            const data = await res.json();
            if (data.success) {
                setMessages(data.messages.map((m: any) => ({
                    id: m.id,
                    content: m.content,
                    isUser: m.is_user,
                    timestamp: new Date(m.timestamp),
                    escrowId: m.escrow_id,
                    txHash: m.tx_hash,
                    imagePreview: m.image_preview,
                })));
                setCurrentSessionId(sessionId);
            }
        } catch (e) {
            console.error('Failed to load session:', e);
        }
    }, []);

    const createNewSession = useCallback(async (options?: { clearMessages?: boolean }) => {
        if (!address) {
            toast.error('Connect wallet to start a chat');
            return null;
        }

        const shouldClearMessages = options?.clearMessages !== false; // default true

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success || !data?.session?.id) {
                throw new Error(data?.error || `HTTP ${res.status}`);
            }

            setCurrentSessionId(data.session.id);
            if (shouldClearMessages) {
                setMessages([]);
                toast.success('New chat started');
            }
            await refreshSessions();
            return data.session.id;
        } catch (e) {
            console.error('Failed to create session:', e);
            const rawMessage = e instanceof Error ? e.message : 'Failed to create new chat';
            const message = /Failed to fetch|NetworkError|Load failed/i.test(rawMessage)
                ? `Cannot reach backend at ${API_BASE_URL}. Check VITE_API_URL and backend server.`
                : rawMessage;
            toast.error(`Failed to create new chat: ${message}`);
        }
        return null;
    }, [address, refreshSessions]);

    const deleteSession = useCallback(async (sessionId: string) => {
        if (!address) return;

        try {
            await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}?wallet=${address}`, {
                method: 'DELETE',
            });
            await refreshSessions();
            if (currentSessionId === sessionId) {
                setCurrentSessionId(null);
                setMessages([]);
            }
            toast.success('Chat deleted');
        } catch (e) {
            console.error('Failed to delete session:', e);
        }
    }, [address, currentSessionId, refreshSessions]);

    const saveMessageToDb = useCallback(async (message: Message, sessionIdOverride?: string) => {
        const targetSessionId = sessionIdOverride || currentSessionId;
        if (!targetSessionId) return;

        try {
            const res = await fetch(`${API_BASE_URL}/chat/sessions/${targetSessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: message.id,
                    content: message.content,
                    is_user: message.isUser,
                    escrow_id: message.escrowId,
                    tx_hash: message.txHash,
                    image_preview: message.imagePreview,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || `HTTP ${res.status}`);
            }

            // Refresh sessions to update titles
            await refreshSessions();
        } catch (e) {
            console.error('Failed to save message:', e);
        }
    }, [currentSessionId, refreshSessions]);

    const clearChat = useCallback(async () => {
        if (currentSessionId) {
            try {
                await fetch(`${API_BASE_URL}/chat/sessions/${currentSessionId}/messages`, {
                    method: 'DELETE',
                });
            } catch (e) {
                console.error('Failed to clear messages:', e);
            }
        }
        setMessages([]);
        toast.success('Chat cleared');
    }, [currentSessionId]);

    return (
        <ChatContext.Provider value={{
            messages,
            setMessages,
            clearChat,
            sessions,
            currentSessionId,
            loadSession,
            createNewSession,
            deleteSession,
            refreshSessions,
            saveMessageToDb
        }}>
            {children}
        </ChatContext.Provider>
    );
}

export function useChatContext() {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
