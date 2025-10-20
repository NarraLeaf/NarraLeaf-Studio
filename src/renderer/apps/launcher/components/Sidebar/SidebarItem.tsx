import React from "react";

type SidebarItemProps = {
    active?: boolean;
    icon?: React.ReactNode;
    text: string;
    onClick?: () => void;
};

export function SidebarItem({ active, icon, text, onClick }: SidebarItemProps) {
    return (
        <button
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                active ? "bg-white/10 text-white" : "text-gray-300 hover:bg-white/10"
            }`}
            onClick={onClick}
        >
            {icon}
            <span className="truncate">{text}</span>
        </button>
    );
}


