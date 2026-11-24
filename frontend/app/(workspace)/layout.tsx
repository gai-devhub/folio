import WorkspaceFrame from '@/components/WorkspaceFrame'

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>
}
