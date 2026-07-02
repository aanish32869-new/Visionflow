 
import { useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { Menu, X } from "lucide-react";
import EcrioLogo from "./EcrioLogo";

export default function Layout({ children }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex h-screen bg-[#f6f7fb] overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex shrink-0 z-10 relative">
        <Sidebar />
      </div>

      {/* Mobile Sidebar Overlay (Responsive Mobile Navigation) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onClick={() => setMobileMenuOpen(false)}></div>
          <div className="relative flex flex-col w-64 bg-white h-full shadow-2xl transform transition-transform">
             <Sidebar />
             <button onClick={() => setMobileMenuOpen(false)} className="absolute top-4 -right-12 text-white p-2 hover:bg-white/20 rounded-full transition">
                <X size={24} />
             </button>
          </div>
        </div>
      )}

      {/* Main Flexible Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Action Header */}
        <div className="md:hidden flex items-center justify-between bg-[var(--ecrio-dark)] border-b border-[var(--ecrio-dark-card)] text-white p-4 shadow-md z-20 relative">
          <div className="font-bold tracking-tight flex items-center gap-2">
             <EcrioLogo size={28} variant="light" />
          </div>
          <button onClick={() => setMobileMenuOpen(true)} className="p-1 hover:bg-white/20 outline-none rounded transition">
             <Menu size={24} />
          </button>
        </div>

        <div className="hidden md:block shadow-sm z-10 relative bg-white">
          <Navbar />
        </div>

        {/* Scalable Container bounds safely padding content cleanly responsive across views */}
        <div key={location.pathname} className="p-4 sm:p-6 md:p-8 overflow-y-auto flex-1 w-full relative animate-page-enter">
          {children}
        </div>
      </div>
    </div>
  );
}