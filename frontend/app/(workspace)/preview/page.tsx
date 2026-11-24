import DocumentPreview from './preview'

type PreviewSearchParams = {
  filename?: string
  folder?: string
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<PreviewSearchParams>
}) {
  const params = await searchParams
  return <DocumentPreview filename={params.filename || ''} folder={params.folder || ''} />
}
