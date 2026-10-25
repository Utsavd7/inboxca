"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {reviewFigure,saveFigureEdit} from "./dataset-actions";
import {Pending} from "../../pending";

// Kept drafts are separate from checked figures and never change a prepared form.
export function FigureEdit({client,draft,line,revision,value,reason="",kind,kept=false}:{client:string;draft:string;line:string;revision:number;value:string;reason?:string;kind?:string;kept?:boolean}) {
  const [fields,setFields]=useState({value,reason}),[message,setMessage]=useState(kept ? "Your draft is kept. Save the correction when it is ready." : "");
  const latest=useRef({value,reason}),dirty=useRef(false),submitted=useRef(false),timer=useRef<number|undefined>(undefined),sequence=useRef(0),queue=useRef(Promise.resolve());
  const flush=useCallback(()=>{
    window.clearTimeout(timer.current);
    if(!dirty.current || submitted.current) return;
    dirty.current=false;const current=++sequence.current,values={...latest.current};
    const run=async()=>{
      const form=new FormData();Object.entries({client,draft,line,revision:String(revision),...values}).forEach(([key,value])=>form.set(key,value));
      try {const saved=await saveFigureEdit(form);if(current===sequence.current) setMessage(saved ? "Your draft is kept. Save the correction when it is ready." : "This draft was not kept. Leave this page open until you save the correction.");}
      catch {if(current===sequence.current) setMessage("This draft was not kept. Leave this page open until you save the correction.");}
    };
    queue.current=queue.current.then(run,run);
  },[client,draft,line,revision]);
  useEffect(()=>{
    window.addEventListener("inboxca-closing",flush);
    return ()=>{window.removeEventListener("inboxca-closing",flush);flush();};
  },[flush]);
  const change=(key:"value"|"reason",value:string)=>{
    sequence.current++;latest.current={...latest.current,[key]:value};setFields(latest.current);dirty.current=true;
    setMessage("Keeping your draft...");window.clearTimeout(timer.current);timer.current=window.setTimeout(flush,300);
  };
  return <form action={reviewFigure} className="fields" onSubmit={()=>{submitted.current=true;window.clearTimeout(timer.current);}}>
    {Object.entries({client,draft,line,revision:String(revision),intent:"edit"}).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
    <div><label htmlFor="figure-value">Correct figure</label><input id="figure-value" name="value" type={kind==="date" ? "date" : "text"} inputMode={!kind || kind==="number" ? "decimal" : "text"} value={fields.value} maxLength={2000} onChange={event=>change("value",event.target.value)} onBlur={flush}/></div>
    <div><label htmlFor="figure-reason">Why it changed</label><input id="figure-reason" name="reason" maxLength={300} value={fields.reason} onChange={event=>change("reason",event.target.value)} onBlur={flush}/></div>
    <p className="hint" aria-live="polite">{message}</p><Pending className="b b-secondary">Save correction</Pending>
  </form>;
}
