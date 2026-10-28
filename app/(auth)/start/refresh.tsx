"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Asks the server again every few seconds while the first payment is confirmed; the page opens
// the app by itself once it is in.
export function Refresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
