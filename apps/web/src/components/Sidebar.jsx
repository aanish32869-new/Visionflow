 
import { Link, useLocation } from "react-router-dom";
import {
  Home,
  Folder,
  Rocket,
} from "lucide-react";

export default function Sidebar() {
  const { pathname } = useLocation();

  const menu = [
    { name: "Home", path: "/", icon: Home },
    { name: "Projects", path: "/projects", icon: Folder },
    { name: "Deployments", path: "/deploy", icon: Rocket },
  ];

  return (
    <div className="w-64 bg-gradient-to-b from-[#0f172a] to-[#581c87] text-white flex flex-col justify-between">
      
      <div>
        <div className="p-5 text-lg font-semibold tracking-tight text-white mb-2">VisionFlow</div>

        <div className="px-3 space-y-1">
          {menu.map((item, i) => (
            <Link
              key={i}
              to={item.path}
              style={{ animationDelay: `${i * 45}ms` }}
              className={`group flex items-center gap-3 px-4 py-2 rounded-md text-[14.5px] font-medium transition-all duration-300 animate-sidebar-item ${
                pathname === item.path
                  ? "bg-violet-600 shadow-sm text-white scale-[1.02]"
                  : "hover:bg-white/10 hover:translate-x-1.5 text-gray-300 hover:text-white"
              }`}
            >
              <item.icon size={18} className={`transition-transform duration-300 ${pathname === item.path ? 'scale-110' : 'group-hover:scale-110'}`} strokeWidth={2.5}/>
              {item.name}
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
