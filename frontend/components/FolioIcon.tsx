import Image from 'next/image'

export type FolioIconName = 'file' | 'folder' | 'folderOpen' | 'computer' | 'upload' | 'workspace'

const iconSources: Record<FolioIconName, string> = {
  file: '/file-icon.svg',
  folder: '/folder-icon.png',
  folderOpen: '/folder-open-icon.svg',
  computer: '/computer-icon.svg',
  upload: '/upload-icon.svg',
  workspace: '/workspace-icon.svg',
}

export default function FolioIcon({ name, size = 24, className, alt = '' }: { name: FolioIconName; size?: number; className?: string; alt?: string }) {
  return <Image src={iconSources[name]} alt={alt} width={size} height={size} className={className} aria-hidden={alt ? undefined : true} />
}
