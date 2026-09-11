import { cookies } from "next/headers";
import { Toaster } from "sonner";

import { QueryClientProvider } from "@/components/query-client-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/workspace/command-palette";
import { GatewayOfflineBanner } from "@/components/workspace/gateway-offline-banner";
import { AgentPet } from "@/components/workspace/pet/agent-pet";
import { SettingsDialogHost } from "@/components/workspace/settings";
import { WorkspaceSettingsDeepLink } from "@/components/workspace/workspace-settings-deep-link";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { ActivityProvider } from "@/core/threads/activity-context";

function parseSidebarOpenCookie(
  value: string | undefined,
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function WorkspaceContent({
  children,
  gatewayUnavailable = false,
}: Readonly<{
  children: React.ReactNode;
  gatewayUnavailable?: boolean;
}>) {
  const cookieStore = await cookies();
  const initialSidebarOpen = parseSidebarOpenCookie(
    cookieStore.get("sidebar_state")?.value,
  );

  return (
    <QueryClientProvider>
      {/* 外壳订阅「当前活跃线程」(spec §10.3):目标由会话主面注册,外壳拿到就自己
          续订、不随页面卸载而断。没人注册时它是惰性的 —— 一个请求都不发。 */}
      <ActivityProvider>
        <SidebarProvider className="h-screen" defaultOpen={initialSidebarOpen}>
          <WorkspaceSidebar />
          {/* 内容区自己带容器上下文:宠物的 @container 隐藏规则要量**内容区**宽度,
              而不是 ResizablePanelGroup 上那个(它量的是 chat + 侧面板总宽) */}
          <SidebarInset className="min-w-0 [container-type:inline-size]">
            <GatewayOfflineBanner gatewayUnavailable={gatewayUnavailable} />
            {children}
            {/* 宠物挂在外壳而不是聊天页里 —— 换页时它还在,这就是「app 的灯」(§10.3) */}
            <AgentPet />
          </SidebarInset>
        </SidebarProvider>
      </ActivityProvider>
      <CommandPalette />
      <SettingsDialogHost />
      <WorkspaceSettingsDeepLink />
      {/* 通知（2026-08-31 定案）：右下角 + 可关闭——瞬时反馈不挡视野，
          主流 toast 惯例（原 top-center 无 × 被用户质疑） */}
      <Toaster closeButton position="bottom-right" />
    </QueryClientProvider>
  );
}
