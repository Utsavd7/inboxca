import "./return-work.css";
import {checkTitle,type Difference} from "@/src/lib/itr-check";

// A return's differences with the client's Form 26AS and Form 16 (src/lib/itr-check.ts), one
// plain line each. InboxCA never changes the return. tick: the approval's box, inside its form
// or tied to the form with that id; the browser and then the server ask for it.
export function ItrDifferences({differences,tick}:{differences:Difference[];tick?:true|string}) {
  if(!differences.length) return null;
  return <section className="fill-checks" aria-label="Differences with Form 26AS">
    <p><strong>{checkTitle(differences)}</strong> InboxCA does not change the return. You decide what it claims.</p>
    <ul>{differences.map(item=><li key={item.text}><span className="grow">{item.text}</span></li>)}</ul>
    {tick && <label className="check"><input type="checkbox" name="differences_seen" value="1" form={typeof tick==="string" ? tick : undefined} required/>I have looked at these differences</label>}
  </section>;
}
