"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Older links name a section, such as /app/settings#office. When that section is in another
// group, open its group and keep the anchor.
export function GroupAnchor({ groupOf }: { groupOf: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (groupOf[id] && !document.getElementById(id)) router.replace(`/app/settings?group=${groupOf[id]}#${id}`);
  }, [groupOf, router]);
  return null;
}
