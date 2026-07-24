import { redirect } from "next/navigation";

// The Reader view demo now lives at /reader/[id] -- kept this route around
// as a redirect since it's what earlier testing bookmarked/linked to.
export default function ReaderDemoRedirect() {
  redirect("/reader/mock-article-1");
}
