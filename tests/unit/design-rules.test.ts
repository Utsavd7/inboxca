import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";

// The signed in app's one design rule: every colour comes from the tokens in app.css's
// html:has(.ui) block, so the look stays one look on every page.
const files=readdirSync("app/(app)",{recursive:true,encoding:"utf8"}).map((file)=>`app/(app)/${file}`);
const raw=/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/gi;

function colourProblems(css:string){
  const outside=css.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^html:has\(\.ui\) \{[\s\S]*?\n\}/m,"");
  return [...outside.matchAll(/[{;]\s*([a-z-]+)\s*:\s*([^;{}]+)/g)].filter(([,,value])=>value.match(raw)).map(([,name,value])=>`${name}: ${value.trim()}`);
}

it("keeps every colour in the signed in app's style sheets on a token",()=>{
  const sheets=files.filter((file)=>file.endsWith(".css"));
  expect(sheets).toContain("app/(app)/app/app.css");
  for(const file of sheets) expect(colourProblems(readFileSync(file,"utf8")),file).toEqual([]);
});

it("keeps raw colours out of inline styles in the signed in app",()=>{
  for(const file of files.filter((name)=>name.endsWith(".tsx")))
    expect([...readFileSync(file,"utf8").matchAll(/style=\{\{[^}]*\}\}/g)].map(([style])=>style).filter((style)=>style.match(raw)),file).toEqual([]);
});

it("catches a colour outside the tokens, and allows one inside them",()=>{
  expect(colourProblems("html:has(.ui) {\n  --ink: #101828;\n}\n.a{color:var(--ink);border:1px solid #fff;background:rgba(0,0,0,.1)}"))
    .toEqual(["border: 1px solid #fff","background: rgba(0,0,0,.1)"]);
});
