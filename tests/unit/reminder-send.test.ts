import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {Job} from "@/src/jobs/runner";
const mock=vi.hoisted(()=>({send:vi.fn(),found:vi.fn(),details:{} as Record<string,unknown>,filed:false,data:false,sent:0,clients:1,due:"2026-10-20",on:true}));
vi.mock("@/src/lib/firm-mail",()=>({firmMailer:async()=>({send:mock.send,sentAlready:mock.found})}));
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({decrypt:async()=>"client@invented.test"})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>({from:(table:string)=>({
  columns:"",write:false,
  select(columns:string){this.columns=columns;return this;},eq(){return this;},is(){return this;},gte(){return this;},lte(){return this;},in(){return this;},neq(){return this;},gt(){return this;},
  update(value:{details?:Record<string,unknown>}){if(table==="tasks")mock.details=value.details ?? {};this.write=true;return this;},
  insert(){this.write=true;return this;},
  async maybeSingle(){return {data:{name:"Invented Firm",settings:{reminders:mock.on}}};},
  then(resolve:(value:unknown)=>void){resolve({error:null,count:mock.sent,data:this.write ? null : table==="tasks" ? mock.filed ? [] : Array.from({length:mock.clients},(_,n)=>({id:`task${n}`,client_id:`client${n}`,code:"GSTR3B_M",period_key:"2026-09",due_on:mock.due,details:mock.details,clients:{name:"Invented Client",email_enc:"encrypted test email",reminders_paused:false}})) : table==="compliance_types" ? [{code:"GSTR3B_M",name:"GSTR-3B",frequency:"monthly",verified_on:"2026-01-01"}] : table==="documents" && mock.data ? [{client_id:"client0",work_type:"gst",period_key:"2026-09"}] : []});},
})})}));
import {sendReminders} from "@/src/jobs/reminders";
const job={entity_id:"firm"} as Job;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-17T05:00:00Z"));vi.clearAllMocks();mock.details={reminder:{day:"2026-10-17",state:"sending"}};mock.filed=false;mock.data=false;mock.sent=0;mock.clients=1;mock.due="2026-10-20";mock.on=true;mock.found.mockResolvedValue(true);mock.send.mockResolvedValue(true);});
afterEach(()=>vi.useRealTimers());
// M5 acceptance: the reminder sender reconciles a possible send, not just the job lease.
it("finds a reminder in Sent after a crash and never sends a duplicate",async()=>{
  await sendReminders(job,{markSending:async()=>{}});
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.found).toHaveBeenCalledOnce();
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.details.reminder).toEqual({day:"2026-10-17",state:"sent"});
});
// M5 acceptance: data already received for the month means no reminder.
it("skips filed work, received data and new work added after today's email",async()=>{
  mock.filed=true;
  await sendReminders(job,{markSending:async()=>{}});
  mock.filed=false;mock.data=true;
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.details.skipped).toEqual({day:"2026-10-17",reason:"data_received"});
  mock.data=false;mock.details={};mock.sent=1;
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.send).not.toHaveBeenCalled();
});

// M3 review: one uncertain recipient must not hold up the firm's other clients.
it("continues other clients after a send failure or an unavailable Sent check",async()=>{
  mock.clients=2;mock.details={};mock.found.mockResolvedValue(false);
  mock.send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await sendReminders(job,{markSending:async()=>{}})).toEqual({retry:"mail_not_sent",patient:true});
  expect(mock.send).toHaveBeenCalledTimes(2);
  mock.send.mockClear();mock.details={reminder:{day:"2026-10-17",state:"sending"}};
  mock.found.mockRejectedValueOnce(new Error("Sent unavailable")).mockResolvedValue(false);
  expect(await sendReminders(job,{markSending:async()=>{}})).toEqual({retry:"mail_not_sent",patient:true});
  expect(mock.send).toHaveBeenCalledOnce();
});

// Today's "Remind all late clients": every late return goes now, even ten days late and with
// the daily reminders off; the daily run would leave it for its stages.
it("reminds a client ten days late at once when asked, and only then",async()=>{
  mock.details={};mock.due="2026-10-07";mock.on=false;
  await sendReminders(job,{markSending:async()=>{}});
  mock.on=true;
  await sendReminders(job,{markSending:async()=>{}});
  expect(mock.send).not.toHaveBeenCalled();
  await sendReminders({entity_id:"firm",entity_type:"late"} as Job,{markSending:async()=>{}});
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.send.mock.calls[0][1]).toBe("Overdue: GSTR-3B due 7 Oct 2026");
});
