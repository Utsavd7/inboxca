import {createHash} from "node:crypto";
import {existsSync,readFileSync} from "node:fs";

// A template's official file: the copy shipped in reference/official, else the one Orelu's
// admin took from the daily check without an app release, fetched with the link the app signed
// into this request and kept here for the next requests. Its SHA-256 is checked every time.
const stored=new Map<string,Buffer>();
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function shipped(file:string) {
  if(!/^[a-z0-9_./-]+$/i.test(file) || file.includes("..") || file.startsWith("/")) throw new Error("Unknown official file");
  return new URL(`../reference/official/${file}`,import.meta.url);
}

export function officialFile(file:string,hash:string) {
  const bytes=existsSync(shipped(file)) ? readFileSync(shipped(file)) : stored.get(hash);
  if(!bytes) throw new Error("Unknown official file");
  if(sha(bytes)!==hash) throw new Error("The official file changed");
  return bytes;
}

export async function fetchOfficial(source:{file:string;sha256:string},link?:string,fetcher:typeof fetch=fetch) {
  if(existsSync(shipped(source.file)) || stored.has(source.sha256) || !link) return;
  const response=await fetcher(link,{signal:AbortSignal.timeout(60_000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!response.ok || sha(bytes)!==source.sha256) throw new Error("The official file changed");
  // Only a few versions are taken between releases: keep the last four.
  if(stored.size>=4) stored.delete(stored.keys().next().value!);
  stored.set(source.sha256,bytes);
}
