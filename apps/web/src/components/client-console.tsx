"use client";

import dynamic from "next/dynamic";
import { Providers } from "./providers";

// The console lives on per-viewer state (localStorage) and the wallet: render it in the browser only,
// so its first render already has that state and never mismatches a server render.
const Console = dynamic(() => import("./console").then((m) => m.Console), {
  ssr: false,
  loading: () => (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-20 md:px-6 lg:grid-cols-[22rem_1fr]">
      <div className="skeleton h-80 rounded-md" />
      <div className="skeleton h-96 rounded-md" />
    </div>
  ),
});

export function ClientConsole() {
  return (
    <Providers>
      <Console />
    </Providers>
  );
}
