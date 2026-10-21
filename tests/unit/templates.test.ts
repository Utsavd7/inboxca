import {expect,it} from "vitest";
import {chooseTemplate,type Template} from "@/src/lib/templates";

// These dates test library selection, not government applicability.
const template=(version:string,from:string,until:string|null,status:Template["status"]="active"):Template=>({form_code:"GSTR1",version,valid_from:from,valid_until:until,status,source:{file:"invented.xlsx",url:"https://tutorial.gst.gov.in/",sha256:"a".repeat(64)},mappings:{format:"xlsx",sheets:{b2b:2}}}); // ggignore: invented source checksum.
it("chooses from the work's period and keeps retired forms for late work",()=>{
  const old=template("1.0","2024-04-01","2025-04-01","retired"),current=template("2.0","2025-04-01",null);
  expect(chooseTemplate([current,old],"GSTR1","2024-09").version).toBe("1.0");
  expect(chooseTemplate([old,current],"GSTR1","2025-04").version).toBe("2.0");
  expect(()=>chooseTemplate([old,current],"GSTR1","2025-04","1.0","Older software")).toThrow("not ready");
  expect(()=>chooseTemplate([current],"GSTR1","2025-13")).toThrow("month");
});
it("prefers the newer active version in one period and requires a reason for an older one",()=>{
  const old=template("2.9","2025-04-01",null),newer=template("2.10","2025-04-01",null),draft=template("3.0","2025-04-01",null,"draft");
  expect(chooseTemplate([old,draft,newer],"GSTR1","2026-09").version).toBe("2.10");
  expect(()=>chooseTemplate([old,newer],"GSTR1","2026-09","2.9")).toThrow("why");
  expect(chooseTemplate([old,newer],"GSTR1","2026-09","2.9","Filing software needs this form").version).toBe("2.9");
  expect(()=>chooseTemplate([old,draft],"GSTR1","2026-09","3.0","New form")).toThrow("not ready");
});
