 
import { Link, useLocation } from "react-router-dom";
import {
  Home,
  Folder,
  Rocket,
  Settings,
} from "lucide-react";
import EcrioLogo from "./EcrioLogo";

export default function Sidebar() {
  const { pathname } = useLocation();

  const menu = [
    { name: "Home", path: "/", icon: Home },
    { name: "Projects", path: "/projects", icon: Folder },
    { name: "Deployments", path: "/deploy", icon: Rocket },
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 text-gray-600 flex flex-col justify-between">
      
      <div>
        {/* Logo area — white bg, grey border */}
        <div className="mx-3 mt-3 mb-2 p-3 rounded-lg bg-white border border-gray-200 flex items-center justify-between">
          <EcrioLogo size={32} variant="light" />
          <Link
            to="/settings"
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            title="Settings"
          >
            <Settings size={17} />
          </Link>
        </div>

        <div className="px-3 space-y-1">
          {menu.map((item, i) => (
            <Link
              key={i}
              to={item.path}
              style={{ animationDelay: `${i * 45}ms` }}
              className={`group flex items-center gap-3 px-4 py-2 rounded-md text-[14.5px] font-medium transition-all duration-300 animate-sidebar-item ${
                pathname === item.path
                  ? "bg-gray-100 text-gray-800 shadow-sm scale-[1.02]"
                  : "hover:bg-gray-50 hover:translate-x-1.5 text-gray-500 hover:text-gray-700"
              }`}
            >
              <item.icon size={18} className={`transition-transform duration-300 ${pathname === item.path ? 'scale-110 text-gray-700' : 'group-hover:scale-110'}`} strokeWidth={2.5}/>
              {item.name}
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
