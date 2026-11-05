import { DevSwitch } from "@/app/dev/switch/bar";

// The app's pages, with the developer preview's bar when it is on (app/dev/switch).
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <DevSwitch />
    </>
  );
}
