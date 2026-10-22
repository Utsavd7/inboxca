import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {actAs,asOwner,attempt,connect,rollback} from "./db";

// #47: a standing right covers its own clients and last day only, including direct writes.
it("checks role and person scopes in a set before a return can be marked filed",async()=>{
  const db=await connect();
  try {await rollback(db,async()=>{
    const firm=randomUUID(),other=randomUUID(),person=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'invented-scope@rights.test')",[person]);
    await db.query("insert into public.firms(id,name,state_code,status,settings) values($1,'Invented Rights Firm','24','active','{\"permissions\":{\"employee\":{\"mark_filed\":false}}}'),($2,'Invented Other Firm','24','active','{}')",[firm,other]);
    await db.query("insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'staff','active')",[firm,person]);
    await db.query("insert into public.clients(id,firm_id,name,kind) values($1,$4,'Invented Alpha','business'),($2,$4,'Invented Beta','business'),($3,$5,'Invented Other','business')",[a,b,c,firm,other]);
    const task=(await db.query("insert into public.tasks(firm_id,client_id,kind,due_on) values($1,$2,'compliance',current_date) returning id",[firm,a])).rows[0].id;
    await actAs(db,person);
    expect((await db.query("select * from public.clients_with_right('mark_filed')")).rowCount).toBe(0);
    expect((await attempt(db,"update public.tasks set status='filed',details=jsonb_build_object('filed_on',current_date) where id=$1",[task])).ok).toBe(false);
    await asOwner(db);
    await db.query("update public.firm_members set access=jsonb_build_object('always',jsonb_build_array(jsonb_build_object('right','mark_filed','clients',jsonb_build_array($3::text),'until',(now() at time zone 'Asia/Kolkata')::date::text))) where firm_id=$1 and user_id=$2",[firm,person,a]);
    await actAs(db,person);
    expect((await db.query("select public.clients_with_right('mark_filed') id")).rows).toEqual([{id:a}]);
    expect(await attempt(db,"update public.tasks set status='filed',details=jsonb_build_object('filed_on',current_date) where id=$1",[task])).toMatchObject({ok:true});
    await asOwner(db);
    await db.query("update public.firm_members set access=jsonb_set(access,'{always,0,until}',to_jsonb(((now() at time zone 'Asia/Kolkata')::date-1)::text)) where firm_id=$1 and user_id=$2",[firm,person]);
    await actAs(db,person);expect((await db.query("select * from public.clients_with_right('mark_filed')")).rowCount).toBe(0);
    await asOwner(db);
    await db.query("update public.firms set settings=jsonb_build_object('permissions',jsonb_build_object('employee',jsonb_build_object('mark_filed',true,'scope',jsonb_build_object('clients',jsonb_build_array($2::text))))) where id=$1",[firm,b]);
    await actAs(db,person);expect((await db.query("select public.clients_with_right('mark_filed') id")).rows).toEqual([{id:b}]);
    await asOwner(db);await db.query("update public.firms set settings=settings||'{\"client_visibility\":\"restricted\"}' where id=$1",[firm]);
    await actAs(db,person);expect((await db.query("select * from public.clients_with_right('mark_filed')")).rowCount).toBe(0);
    await asOwner(db);await db.query("insert into public.client_assignments(firm_id,client_id,user_id,role) values($1,$2,$3,'staff')",[firm,b,person]);
    await actAs(db,person);expect((await db.query("select public.clients_with_right('mark_filed') id")).rows).toEqual([{id:b}]);
  });} finally {await db.end();}
});

// #14 and #54: unfinished edits survive closing without confirming or changing a figure.
it("keeps encrypted edits through another review, without changing revisions or approvals",async()=>{
  const db=await connect();
  try {await rollback(db,async()=>{
    const firm=randomUUID(),client=randomUUID(),person=randomUUID(),draft=randomUUID(),line=randomUUID(),document=randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'invented-draft@rights.test')",[person]);
    await db.query("insert into public.firms(id,name,state_code,status) values($1,'Invented Draft Firm','24','active')",[firm]);
    await db.query("insert into public.firm_members(firm_id,user_id,role,status) values($1,$2,'staff','active')",[firm,person]);
    await db.query("insert into public.clients(id,firm_id,name,kind) values($1,$2,'Invented Draft Client','business')",[client,firm]);
    const base="invented-encrypted-original",value="invented-encrypted-candidate"; // ggignore: opaque test values, not credentials.
    const body={lines:[{id:line,value_enc:base,state:"confirmed"}],checks:[]};
    await db.query("insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values($1,$2,$3,'GSTR1','2026-09',$4)",[draft,firm,client,JSON.stringify(body)]);
    await db.query("insert into public.documents(id,firm_id,client_id,work_type,name,document_type,period_key,drive_file_id,sha256,size,prepared) values($1,$2,$3,'gst','Invented form.xlsx','GSTR-1','2026-09','invented-file',repeat('a',64),100,$4)",[document,firm,client,JSON.stringify({form:"GSTR1",registration:client,version:1,status:"approved",sources:[{id:draft,revision:1}]})]);
    const save=()=>db.query("select public.save_figure_edit($1,$2,$3,$4,$5,$6,$7) saved",[draft,firm,client,person,line,base,value]);
    expect((await save()).rows[0].saved).toBe(true);
    const [kept]=(await db.query("select data,revision from public.datasets where id=$1",[draft])).rows;
    expect(kept.revision).toBe(1);expect(kept.data.lines).toEqual(body.lines);expect(kept.data.edits[person][line]).toEqual({base,value_enc:value});
    expect((await db.query("select prepared->>'status' status from public.documents where id=$1",[document])).rows[0].status).toBe("approved");
    await actAs(db,person);expect((await attempt(db,"select public.save_figure_edit($1,$2,$3,$4,$5,$6,$7)",[draft,firm,client,person,line,base,value])).ok).toBe(false);
    await asOwner(db);
    expect((await db.query("select public.save_dataset($1,$2,$3,'GSTR1','2026-09',1,$4,$5,'dataset.checked','{}') saved",[draft,firm,client,JSON.stringify(body),person])).rows[0].saved).toBe(true);
    expect((await db.query("select data->'edits' edits,revision from public.datasets where id=$1",[draft])).rows[0]).toEqual({edits:kept.data.edits,revision:2});
    expect((await db.query("select prepared->>'status' status from public.documents where id=$1",[document])).rows[0].status).toBe("draft");
    body.lines[0].value_enc="invented-encrypted-new-value";
    expect((await db.query("select public.save_dataset($1,$2,$3,'GSTR1','2026-09',2,$4,$5,'dataset.changed','{}') saved",[draft,firm,client,JSON.stringify(body),person])).rows[0].saved).toBe(true);
    expect((await db.query("select data->'edits' edits from public.datasets where id=$1",[draft])).rows[0].edits).toEqual({});
  });} finally {await db.end();}
});
