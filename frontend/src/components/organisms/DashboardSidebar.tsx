"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Boxes,
  CheckCircle2,
  Clock,
  Folder,
  Building2,
  LayoutGrid,
  Network,
  Settings,
  Store,
  Tags,
  DollarSign,
  ChevronLeft,
} from "lucide-react";

import { useAuth } from "@/auth/clerk";
import { ApiError } from "@/api/mutator";
import { useOrganizationMembership } from "@/lib/use-organization-membership";
import {
  type healthzHealthzGetResponse,
  useHealthzHealthzGet,
} from "@/api/generated/health/health";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/templates/DashboardShell";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DashboardSidebar() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const { isAdmin } = useOrganizationMembership(isSignedIn);
  const { collapsed, toggleCollapse } = useSidebar();
  const healthQuery = useHealthzHealthzGet<healthzHealthzGetResponse, ApiError>(
    {
      query: {
        refetchInterval: 30_000,
        refetchOnMount: "always",
        retry: false,
      },
      request: { cache: "no-store" },
    },
  );

  const okValue = healthQuery.data?.data?.ok;
  const systemStatus: "unknown" | "operational" | "degraded" =
    okValue === true
      ? "operational"
      : okValue === false
        ? "degraded"
        : healthQuery.isError
          ? "degraded"
          : "unknown";
  const statusLabel =
    systemStatus === "operational"
      ? "All systems operational"
      : systemStatus === "unknown"
        ? "System status unavailable"
        : "System degraded";

  const navItemClass = cn(
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition",
    collapsed ? "justify-center" : "",
  );

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white pt-16 shadow-lg transition-all duration-200 ease-in-out [[data-sidebar=open]_&]:translate-x-0 md:relative md:inset-auto md:z-auto md:translate-x-0 md:pt-0 md:shadow-none",
        collapsed ? "w-16 -translate-x-full" : "w-[280px] -translate-x-full",
        "[[data-sidebar=open]_&]:translate-x-0 md:translate-x-0",
      )}
    >
      {/* Collapse button */}
      <button
        onClick={toggleCollapse}
        className={cn(
          "absolute -right-3 top-20 z-50 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 md:flex",
          collapsed ? "rotate-180" : "",
        )}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronLeft className="h-3 w-3" />
      </button>

      <div className="flex-1 px-3 py-4">
        {!collapsed && (
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Navigation
          </p>
        )}
        <TooltipProvider delayDuration={collapsed ? 300 : 99999}>
          <nav className="mt-3 space-y-4 text-sm">
            <div>
              {!collapsed && (
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Overview
                </p>
              )}
              <div className="mt-1 space-y-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/dashboard"
                      className={cn(
                        navItemClass,
                        pathname === "/dashboard"
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <BarChart3 className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Dashboard</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Dashboard</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/activity"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/activity")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <Activity className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Live feed</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Live feed</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/memories"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/memories")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <Brain className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Memories</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Memories</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/crons"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/crons")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <Clock className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>定时任务</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">定时任务</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/costs"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/costs")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <DollarSign className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>成本追踪</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">成本追踪</TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>

            <div>
              {!collapsed && (
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Boards
                </p>
              )}
              <div className="mt-1 space-y-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/board-groups"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/board-groups")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <Folder className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Board groups</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Board groups</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/boards"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/boards")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <LayoutGrid className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Boards</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Boards</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/tags"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/tags")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <Tags className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Tags</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Tags</TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/approvals"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/approvals")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Approvals</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Approvals</TooltipContent>
                  )}
                </Tooltip>
                {isAdmin ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href="/custom-fields"
                        className={cn(
                          navItemClass,
                          pathname.startsWith("/custom-fields")
                            ? "bg-blue-100 text-blue-800 font-medium"
                            : "hover:bg-slate-100",
                        )}
                      >
                        <Settings className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>Custom fields</span>}
                      </Link>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right">
                        Custom fields
                      </TooltipContent>
                    )}
                  </Tooltip>
                ) : null}
              </div>
            </div>

            <div>
              {isAdmin ? (
                <>
                  {!collapsed && (
                    <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Skills
                    </p>
                  )}
                  <div className="mt-1 space-y-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href="/skills/marketplace"
                          className={cn(
                            navItemClass,
                            pathname === "/skills" ||
                              pathname.startsWith("/skills/marketplace")
                              ? "bg-blue-100 text-blue-800 font-medium"
                              : "hover:bg-slate-100",
                          )}
                        >
                          <Store className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>Marketplace</span>}
                        </Link>
                      </TooltipTrigger>
                      {collapsed && (
                        <TooltipContent side="right">
                          Marketplace
                        </TooltipContent>
                      )}
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href="/skills/packs"
                          className={cn(
                            navItemClass,
                            pathname.startsWith("/skills/packs")
                              ? "bg-blue-100 text-blue-800 font-medium"
                              : "hover:bg-slate-100",
                          )}
                        >
                          <Boxes className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>Packs</span>}
                        </Link>
                      </TooltipTrigger>
                      {collapsed && (
                        <TooltipContent side="right">Packs</TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                </>
              ) : null}
            </div>

            <div>
              {!collapsed && (
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Administration
                </p>
              )}
              <div className="mt-1 space-y-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/organization"
                      className={cn(
                        navItemClass,
                        pathname.startsWith("/organization")
                          ? "bg-blue-100 text-blue-800 font-medium"
                          : "hover:bg-slate-100",
                      )}
                    >
                      <Building2 className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Organization</span>}
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Organization</TooltipContent>
                  )}
                </Tooltip>
                {isAdmin ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href="/gateways"
                        className={cn(
                          navItemClass,
                          pathname.startsWith("/gateways")
                            ? "bg-blue-100 text-blue-800 font-medium"
                            : "hover:bg-slate-100",
                        )}
                      >
                        <Network className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>Gateways</span>}
                      </Link>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right">Gateways</TooltipContent>
                    )}
                  </Tooltip>
                ) : null}
                {isAdmin ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href="/agents"
                        className={cn(
                          navItemClass,
                          pathname.startsWith("/agents")
                            ? "bg-blue-100 text-blue-800 font-medium"
                            : "hover:bg-slate-100",
                        )}
                      >
                        <Bot className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>Agents</span>}
                      </Link>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right">Agents</TooltipContent>
                    )}
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </nav>
        </TooltipProvider>
      </div>
      {!collapsed && (
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                systemStatus === "operational" && "bg-emerald-500",
                systemStatus === "degraded" && "bg-rose-500",
                systemStatus === "unknown" && "bg-slate-300",
              )}
            />
            {statusLabel}
          </div>
        </div>
      )}
      {collapsed && (
        <div className="border-t border-slate-200 p-3">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "mx-auto block h-2 w-2 rounded-full",
                    systemStatus === "operational" && "bg-emerald-500",
                    systemStatus === "degraded" && "bg-rose-500",
                    systemStatus === "unknown" && "bg-slate-300",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="right">{statusLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </aside>
  );
}
