import { redirect } from "next/navigation";

// The Reader view demo used to point at seed mock data; the library is now
// backed by real saved articles, so there's no guaranteed demo article to
// redirect to. Kept this route around (rather than a 404) since it's what
// earlier testing bookmarked/linked to.
export default function ReaderDemoRedirect() {
  redirect("/library");
}
