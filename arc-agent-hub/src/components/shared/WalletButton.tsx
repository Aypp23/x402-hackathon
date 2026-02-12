import { useWallet } from '@/contexts/WalletContext';
import { Wallet, LogOut, ExternalLink, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function WalletButton() {
  const { isConnected, address, disconnect, connect } = useWallet();

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  if (!isConnected) {
    return (
      <button
        onClick={() => {
          console.log("Connect button clicked");
          connect();
        }}
        className="flex items-center gap-2 px-5 py-2.5 liquid-glass-primary text-primary-foreground rounded-full text-sm font-medium"
      >
        Sign in
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 p-1 liquid-glass-button transition-colors">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-sm font-medium text-primary">
              {address?.slice(2, 4).toUpperCase()}
            </span>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl p-2">
        <div className="px-3 py-2 mb-1">
          <p className="text-sm font-medium">{truncatedAddress}</p>
          <p className="text-xs text-muted-foreground">Connected</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => window.open(`https://sepolia.basescan.org/address/${address}`, '_blank')}
          className="rounded-xl cursor-pointer"
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          View on Explorer
        </DropdownMenuItem>
        <DropdownMenuItem onClick={disconnect} className="rounded-xl cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
