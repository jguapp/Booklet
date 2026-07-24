import { ReaderView } from "@/components/reader/reader-view";

export default async function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReaderView articleId={id} />;
}
