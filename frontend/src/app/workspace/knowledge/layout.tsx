"use client";

import { SubtasksProvider } from "@/core/tasks/context";

export default function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SubtasksProvider>{children}</SubtasksProvider>;
}
