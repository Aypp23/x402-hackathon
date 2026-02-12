import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare, LayoutDashboard, SquarePen, Menu, Wallet, Store, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/contexts/ChatContext';
import { useWallet } from '@/contexts/WalletContext';

// Admin wallet that can see Dashboard (from env)
const ADMIN_ADDRESS = import.meta.env.VITE_ADMIN_ADDRESS || '';

const allBottomNavItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', adminOnly: false },
  { icon: Wallet, label: 'Get test USDC', path: '/deposit', adminOnly: false },
  { icon: Store, label: 'Providers', path: '/providers', adminOnly: false },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  isMobileOpen?: boolean;
}

export function Sidebar({ isCollapsed, onToggle, isMobileOpen }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { createNewSession, sessions, currentSessionId, loadSession, deleteSession, messages } = useChatContext();
  const { address, isConnected } = useWallet();

  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase();

  // Filter nav items based on admin status
  const bottomNavItems = allBottomNavItems.filter(item => !item.adminOnly || isAdmin);

  // On mobile, always show expanded when open
  const showCollapsed = isCollapsed && !isMobileOpen;

  // Find current session info
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const isCurrentChatEmpty = !currentSessionId || (currentSession?.title === 'New Chat' && messages.length === 0);

  const handleNewChat = async () => {
    // Don't create new chat if already on an empty one
    if (isCurrentChatEmpty && messages.length === 0) {
      navigate('/');
      return;
    }
    await createNewSession();
    navigate('/');
  };

  const handleLoadSession = (sessionId: string) => {
    loadSession(sessionId);
    navigate('/');
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await deleteSession(sessionId);
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-full liquid-glass-panel z-50 transition-all duration-300 flex flex-col border-r border-border/30',
        // Mobile: hidden by default, shown when isMobileOpen (always full width)
        'max-md:-translate-x-full max-md:w-72',
        isMobileOpen && 'max-md:translate-x-0',
        // Desktop: respect collapsed state
        !isMobileOpen && (isCollapsed ? 'md:w-16' : 'md:w-72')
      )}
    >
      {/* Header */}
      <div className={cn(
        'p-4 flex items-center',
        showCollapsed ? 'justify-center' : 'gap-3'
      )}>
        <button
          onClick={onToggle}
          className="p-2 hover:bg-accent rounded-full transition-colors"
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>
        {!showCollapsed && (
          <span className="text-xl font-medium text-foreground">Arcana</span>
        )}
      </div>

      {/* New Chat Button */}
      <div className={cn('px-3 pt-4 mb-4', showCollapsed && 'px-2')}>
        <button
          onClick={handleNewChat}
          className={cn(
            'flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground transition-colors',
            showCollapsed ? 'justify-center w-10 h-10 mx-auto' : 'px-2 py-2'
          )}
        >
          <SquarePen className="w-5 h-5" />
          {!showCollapsed && <span>New chat</span>}
        </button>
      </div>

      {/* Chat Sessions */}
      {/* Chat Sessions & Flexible Spacer */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 mb-2 scrollbar-hidden">
        {!showCollapsed && sessions.length > 0 && (
          <>
            <div className="text-xs text-muted-foreground mb-2 px-2 pt-2">Recent Chats</div>
            <div className="space-y-1 pb-4">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLoadSession(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleLoadSession(session.id);
                    }
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors group text-left cursor-pointer',
                    currentSessionId === session.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 truncate">{session.title}</span>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom Navigation Items */}
      <div className={cn('px-3 pb-4', showCollapsed && 'px-2')}>
        {bottomNavItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 rounded-full transition-all duration-200 text-sm',
                showCollapsed ? 'justify-center w-10 h-10 mx-auto my-1' : 'px-4 py-3',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-accent'
              )}
              title={showCollapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!showCollapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </div>
    </aside>
  );
}
