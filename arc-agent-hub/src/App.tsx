import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { ConnectKitProvider } from "connectkit";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { WalletProvider } from "@/contexts/WalletContext";
import { ChatProvider } from "@/contexts/ChatContext";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Deposit from "./pages/Deposit";
import Providers from "./pages/Providers";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <ConnectKitProvider theme="midnight">
        <WalletProvider>
          <ChatProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner position="top-right" theme="dark" />
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/deposit" element={<Deposit />} />
                  <Route path="/providers" element={<Providers />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </ChatProvider>
        </WalletProvider>
      </ConnectKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

export default App;
