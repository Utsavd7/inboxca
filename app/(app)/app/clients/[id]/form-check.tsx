"use client";
import {Check,ChevronDown,Pencil,X} from "lucide-react";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {FormLayout} from "@/src/lib/form-layout";
import {askPermission} from "@/app/(app)/actions";
import {FileViewer,type ViewerPages} from "../../files/[id]/view/file-viewer";
import {typing} from "../../command";
import {Pending} from "../../pending";
import {MenuClose,SourcePane} from "../../returns-client";
import {FigureForm} from "./form-sheet";
import {FigureEdit} from "./figure-edit";
import {reviewFigure} from "./dataset-actions";

// One figure as Check on the form shows it: where the return puts it, its amount for reading,
// how it was read and anything worth a second look, and the paper it came from.
export type CheckItem={id:string;place:string;shown:string;value:string;kind?:string;state:"pending"|"confirmed"|"rejected";corrected:boolean;checked?:string;short?:string;entered?:string;paper?:string;page?:number;sheet?:number;where:string;chips:{text:string;tone:"ok"|"look"|"info"}[];look?:string;blocked?:string};
export type CheckPaper={id:string;name:string;about?:{text:string;ok?:boolean}};
const status=(item:CheckItem)=>item.state==="confirmed" ? "Checked" : item.state==="rejected" ? "Marked wrong" : item.corrected ? "Corrected, check again" : "To check";
// A figure's place without its row's words, for a chip: "4(A)(5) Integrated Tax".
const brief=(item:CheckItem)=>item.place.replace(/^(\d[\d.()A-Z]*) [^,]+, /,"$1 ");
const Ring=({item}:{item:CheckItem})=><span className="fc-ring" aria-hidden>{item.state==="confirmed" ? <Check size={11} strokeWidth={3}/> : item.state==="rejected" ? <X size={11} strokeWidth={3}/> : item.corrected ? <Pencil size={10} strokeWidth={2.6}/> : null}</span>;

// The figures laid out as the return (form-sheet.tsx), the paper of the chosen one beside them
// with its spot marked, and Yes or No in place. J/K or the arrows move, Y says yes and moves to the
// next one still to check, N or E opens the correction, Esc closes it. Yes stays one figure at a time.
export function FormCheck({layout,items,papers,active,client,draft,revision,canCheck,canEdit,ask,why,shown,hideInactive,kept,focus}:{layout:FormLayout;items:CheckItem[];papers:CheckPaper[];active:string;client:string;draft:string;revision:number;canCheck:boolean;canEdit:boolean;ask:boolean;why:string;shown:boolean;hideInactive:boolean;kept:Record<string,{value:string;reason:string}>;focus:boolean}) {
  const byId=useMemo(()=>new Map(items.map((item)=>[item.id,item])),[items]);
  const order=useMemo(()=>layout.tables.flatMap((table)=>table.rows.filter((row)=>row.fill==="figures").flatMap((row)=>row.cells.flatMap((cell)=>cell?.ids ?? []))).filter((id,at,all)=>byId.has(id) && all.indexOf(id)===at),[layout,byId]);
  const [selected,setSelected]=useState(byId.has(active) ? active : order[0]),[editing,setEditing]=useState(false),[viewer,setViewer]=useState<ViewerPages>({pages:[],marks:[],blank:false});
  const [peek,setPeek]=useState<{id:string;left:number;top:number}|null>(null),hover=useRef<number|undefined>(undefined);
  // The page stays mounted when a check comes back (so the paper is not opened again): the figure
  // InboxCA moved on to is chosen, and the correction closes.
  const [seen,setSeen]=useState(`${active}:${revision}`);
  if(seen!==`${active}:${revision}`) {setSeen(`${active}:${revision}`);setSelected(byId.has(active) ? active : order[0]);setEditing(false);}
  const root=useRef<HTMLDivElement>(null),press=(intent:string)=>root.current?.querySelector<HTMLButtonElement>(`.fc-act button[name=intent][value=${intent}]`)?.click();
  // The figure just said yes to: only its ring plays the tick.
  useEffect(()=>{try {const id=sessionStorage.getItem("inboxca-checked");sessionStorage.removeItem("inboxca-checked");if(id) root.current?.querySelector(`[data-figure="${id}"]`)?.classList.add("is-new");} catch {}},[revision]);
  const item=byId.get(selected) ?? items[0],paper=papers.find((one)=>one.id===item?.paper);
  // The next figure still to check after this one, in the form's order, for Yes to move to.
  const next=useMemo(()=>{const at=order.indexOf(selected);return [...order.slice(at+1),...order.slice(0,at)].find((id)=>byId.get(id)!.state!=="confirmed");},[order,selected,byId]);
  const box=(id:string)=>root.current?.querySelector<HTMLElement>(`[data-figure="${id}"]`);
  const choose=useCallback((id:string|undefined,move=true)=>{
    if(!id) return;
    setSelected(id);setEditing(false);setPeek(null);
    const url=new URL(window.location.href);url.searchParams.set("line",id);url.searchParams.delete("check");window.history.replaceState(null,"",url);
    if(move) requestAnimationFrame(()=>{const el=box(id);el?.focus({preventScroll:true});el?.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});});
  },[]);
  // After a check the page comes back with the next figure chosen: keyboard work carries on there.
  useEffect(()=>{if(focus) box(selected)?.focus();},[focus,selected]);
  const disabled=!item || !canCheck || !!item.blocked || item.state==="confirmed";
  const open=()=>{setEditing(true);requestAnimationFrame(()=>document.getElementById("figure-value")?.focus());};
  useEffect(()=>{
    const keys=(event:KeyboardEvent)=>{
      if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[role=dialog], [role=menu]")) return;
      if(event.key==="Escape") {
        if(!editing && !peek) return;
        event.preventDefault();setPeek(null);
        if(editing) {setEditing(false);requestAnimationFrame(()=>box(selected)?.focus());}
        return;
      }
      if(typing(event.target)) return;
      const inside=!!root.current?.contains(document.activeElement),at=order.indexOf(selected),key=event.key.toLowerCase();
      if(key==="j" || inside && (event.key==="ArrowDown" || event.key==="ArrowRight")) choose(order[Math.min(order.length-1,at+1)]);
      else if(key==="k" || inside && (event.key==="ArrowUp" || event.key==="ArrowLeft")) choose(order[Math.max(0,at-1)]);
      else if(key==="y" && !disabled) press("confirmed");
      else if((key==="n" || key==="e") && canEdit) open();
      else if(key==="n" && canCheck) press("rejected");
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown",keys);
    return ()=>document.removeEventListener("keydown",keys);
  });
  const looks=items.filter((one)=>one.look && one.state!=="confirmed");
  const show=(id:string,target:HTMLElement)=>{
    window.clearTimeout(hover.current);
    hover.current=window.setTimeout(()=>{const rect=target.getBoundingClientRect(),below=rect.bottom+150<window.innerHeight;setPeek({id,left:Math.min(rect.left,window.innerWidth-332),top:below ? rect.bottom+6 : rect.top-146});},380);
  };
  const hide=()=>{window.clearTimeout(hover.current);setPeek(null);};
  const peeked=peek && byId.get(peek.id);
  const spot=(one:CheckItem)=>one.paper===item?.paper && one.sheet===item?.sheet ? viewer.marks.find((mark)=>mark.id===one.id) : undefined;
  const cell=(id:string,many:boolean)=>{
    const one=byId.get(id);
    if(!one) return null;
    // One signal at most: what needs a look, else who checked it. The rest is in the paper's pane.
    const look=one.look && one.state!=="confirmed" ? one.look.split(". ")[0] : "",sign=look || one.short;
    return <button key={id} type="button" data-figure={id} className={`fc-box${id===selected ? " is-on" : ""}`} data-state={one.state==="confirmed" ? "done" : one.state==="rejected" ? "wrong" : one.corrected ? "fixed" : "open"}
      tabIndex={id===selected ? 0 : -1} aria-pressed={id===selected} aria-label={`${one.place}: ${one.shown}. ${status(one)}.${one.look && one.state!=="confirmed" ? ` ${one.look}.` : ""}`}
      onClick={()=>choose(id,false)} onFocus={()=>id!==selected && choose(id,false)} onPointerEnter={(event)=>id!==selected && show(id,event.currentTarget)} onPointerLeave={hide}>
      <Ring item={one}/>{many && <span className="fc-part" title={one.place.split(", ").at(-1)}>{one.place.split(", ").at(-1)}</span>}<span className="fc-amount">{one.shown}</span>
      {sign && <span className={`fc-sig${look ? " is-look" : ""}`} title={look ? one.look : `Checked by ${one.checked}`}>{sign}</span>}
    </button>;
  };
  return <div className="fc" ref={root}>
    <div className="fc-main">
      {!!looks.length && <nav className="fc-looks" aria-label="Figures that need a look"><MenuClose/><strong>Needs a look</strong>
        {looks.slice(0,5).map((one)=><button key={one.id} type="button" className="fc-look" title={`${one.place}: ${one.look}`} onClick={()=>choose(one.id)}>{brief(one)}</button>)}
        {looks.length>5 && <details className="rf-menu fc-more"><summary className="fc-look">+{looks.length-5} more<ChevronDown size={13} aria-hidden/></summary><div className="rf-pop is-end">{looks.map((one)=><button key={one.id} type="button" className="rf-pop-item fc-more-item" onClick={(event)=>{event.currentTarget.closest("details")!.open=false;choose(one.id);}}><strong>{brief(one)}</strong><span>{one.look}</span></button>)}</div></details>}
      </nav>}
      <p className="keys fc-keys" aria-hidden><span><kbd>J</kbd><kbd>K</kbd> move</span><span><kbd>Y</kbd> yes</span><span><kbd>N</kbd> no</span>{canEdit && <span><kbd>E</kbd> correct</span>}<span><kbd>Esc</kbd> close</span></p>
      <FigureForm layout={layout} cell={cell} open={(row)=>row.cells.some((one)=>one?.ids?.includes(selected)) && (row.fill==="figures") && <div className="fig-act fc-act">
        <div className="fc-act-head"><p><strong>{item.place}</strong><span className="sr-only">. </span><span className="sub">{status(item)}</span></p><span className="fc-value">{item.shown}</span></div>
        {!editing && <form action={reviewFigure} className="fig-decide" onSubmit={(event)=>{if((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")==="confirmed") try {sessionStorage.setItem("inboxca-checked",item.id);} catch {}}}>
          <input type="hidden" name="client" value={client}/><input type="hidden" name="draft" value={draft}/><input type="hidden" name="line" value={item.id}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="view" value="form"/>{next && <input type="hidden" name="next" value={next}/>}
          <div className="form-row">
            {item.state==="confirmed" ? <p className="fig-done"><Check size={15} strokeWidth={2.6} aria-hidden/>Checked by {item.checked}</p> : <Pending className="b b-primary" name="intent" value="confirmed" disabled={disabled}>Yes, this is right<kbd aria-hidden>Y</kbd></Pending>}
            {canEdit ? <button type="button" className="b b-secondary" onClick={open}>No, this is wrong<kbd aria-hidden>N</kbd></button> : <Pending className="b b-secondary" name="intent" value="rejected" disabled={!canCheck || item.state==="rejected"}>No, this is wrong<kbd aria-hidden>N</kbd></Pending>}
          </div>
          {(item.blocked || why) && item.state!=="confirmed" ? <p className="fig-why">{item.blocked || why}</p> : item.entered && <p className="hint">{item.entered}. Check it against your records.</p>}
        </form>}
        {editing && <div className="fc-fix"><FigureEdit key={`${draft}-${item.id}-${revision}`} client={client} draft={draft} line={item.id} revision={revision} value={kept[item.id]?.value ?? item.value} reason={kept[item.id]?.reason} kind={item.kind} kept={!!kept[item.id]} extra={{view:"form",next:item.id}}/><button type="button" className="b b-ghost b-small" onClick={()=>{setEditing(false);box(selected)?.focus();}}>Cancel<kbd aria-hidden>Esc</kbd></button></div>}
      </div>}/>
      {!!layout.empty?.length && <p className="hint fc-empty">Nothing in these figures for {layout.empty.join(", ")}.</p>}
    </div>
    <SourcePane title={<p className="fig-pane-title"><strong>{paper?.name ?? (item?.entered ? "Typed by your team" : "Source unavailable")}</strong><span className="sr-only">. </span><span className="sub">{item?.where}</span>{paper?.about && <span className={`fc-about${paper.about.ok===undefined ? "" : paper.about.ok ? " is-ok" : " is-off"}`}>{paper.about.ok===true && <Check size={13} strokeWidth={2.6} aria-hidden/>}{paper.about.ok===false && <X size={13} strokeWidth={2.6} aria-hidden/>}{paper.about.text}{paper.about.ok===true && <span className="sr-only">. InboxCA matched this to the client when it read the file.</span>}</span>}</p>}>
      <ul className="fc-facts" aria-label="About this figure">{item?.chips.map((chip)=><li key={chip.text} className={`is-${chip.tone}`}>{chip.text}</li>)}</ul>
      {ask && <form action={askPermission} className="fc-ask"><input type="hidden" name="client" value={client}/><input type="hidden" name="right" value="edit_figures"/><Pending className="b b-ghost b-small">Ask to edit figures</Pending></form>}
      {item?.paper && paper && shown ? <>
        {!!viewer.pages.length && !spot(item) && <p className="hint fc-find">Look for {item.shown} on this page.</p>}
        <FileViewer key={`${paper.id}-${item.sheet ?? 1}`} id={paper.id} sheet={item.sheet ?? 1} page={item.page} hideInactive={hideInactive} marks={draft} mark={item.id} onPages={setViewer}/>
      </> : <p className="hint">{item?.entered ? "There is no paper for this figure: your team typed it." : "The source cannot be shown here yet."}</p>}
    </SourcePane>
    {peeked && <div className="fc-peek" style={{left:peek.left,top:peek.top}} role="tooltip" onContextMenu={(event)=>event.preventDefault()} onDragStart={(event)=>event.preventDefault()}>
      <p><strong>{peeked.place}</strong><span>{peeked.shown}</span></p>
      {(()=>{
        const mark=spot(peeked),page=mark && viewer.pages[mark.page-1];
        if(viewer.blank) return <p className="hint">The pages are hidden for now.</p>;
        if(!mark || !page) return <p className="hint">{peeked.paper ? `${peeked.where}${peeked.paper===item?.paper ? `. Look for ${peeked.shown} on this page.` : ". Choose it to open its paper."}` : peeked.entered}</p>;
        // A crop of the stamped page around the figure's spot, at half size.
        const scale=0.5,width=316,height=92,x=Math.min(0,Math.max(width-page.width*scale,width/2-(mark.x+mark.width/2)*page.width*scale)),y=Math.min(0,Math.max(height-page.height*scale,height/2-(mark.y+mark.height/2)*page.height*scale));
        return <div className="fc-crop" style={{width,height}} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.url} alt="" draggable={false} style={{width:page.width*scale,height:page.height*scale,transform:`translate(${x}px, ${y}px)`}}/>
          <i style={{left:x+mark.x*page.width*scale,top:y+mark.y*page.height*scale,width:mark.width*page.width*scale,height:mark.height*page.height*scale}}/>
        </div>;
      })()}
    </div>}
  </div>;
}
