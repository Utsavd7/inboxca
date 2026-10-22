import type {openView} from "./render.ts";

// A PDF containing only stamped page pictures, never the original text or file.
export async function* stampedPdf(view:Awaited<ReturnType<typeof openView>>) {
  const encoder=new TextEncoder(),offsets=[0];let position=0;
  const bytes=(value:string|Uint8Array)=>{const result=typeof value==="string" ? encoder.encode(value) : value;position+=result.length;return result;};
  const object=(id:number,value:string)=>{offsets[id]=position;return bytes(`${id} 0 obj\n${value}\nendobj\n`);};
  const pages=view.header.pages;
  yield bytes("%PDF-1.4\n");
  yield object(1,"<< /Type /Catalog /Pages 2 0 R >>");
  yield object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,n)=>`${3+n*3} 0 R`).join(" ")}] >>`);
  for(let n=0;n<pages.length;n++) {
    const {width,height}=pages[n],id=3+n*3,frame=await view.render(n+1,true),image=frame.subarray(1);
    if(frame[0]!==2) throw new Error("Expected a page picture");
    yield object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /PageImage ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    offsets[id+1]=position;
    yield bytes(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
    yield bytes(image);yield bytes("\nendstream\nendobj\n");
    const content=`q ${width} 0 0 ${height} 0 0 cm /PageImage Do Q\n`;
    yield object(id+2,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  }
  const start=position;
  yield bytes(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
