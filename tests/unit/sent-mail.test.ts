import {expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({mode:"missing"}));
vi.mock("imapflow",()=>({ImapFlow:class {
  async connect(){if(mock.mode==="offline")throw new Error("offline");}
  async list(){return mock.mode==="missing" ? [] : [{specialUse:"\\Sent",path:"Sent"}];}
  async mailboxOpen(){}
  async search(){return mock.mode==="found" ? [1] : [];}
  async logout(){}
  close(){}
}}));
import {foundInSent} from "@/src/lib/mailbox";
it("never turns an unavailable Sent folder into permission to repeat an uncertain send",async()=>{
  const read=()=>foundInSent("office@invented.test","invented test password",{host:"127.0.0.1",port:3143},"<invented@inboxca.test>");
  mock.mode="missing";await expect(read()).rejects.toThrow("sent_not_read");
  mock.mode="offline";await expect(read()).rejects.toThrow("sent_not_read");
  mock.mode="found";expect(await read()).toBe(true);
  mock.mode="empty";expect(await read()).toBe(false);
});
