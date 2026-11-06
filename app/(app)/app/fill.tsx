"use client";
import "./return-work.css";
import {useActionState} from "react";
import {fillNow,type FillState} from "./form-actions";
import {Pending} from "./pending";

// Fill for one return. If InboxCA cannot fill it, the reason shows under the button. words: the
// button's own, as the primary action of a return's own page.
export function Fill({task,label,words}:{task:string;label:string;words?:string}) {
  const [state,send]=useActionState<FillState,FormData>(fillNow,{});
  return <form action={send} className="fill-now">
    <input type="hidden" name="task" value={task}/>
    <Pending className={`b ${words ? "b-primary" : "b-secondary"}`} busy="Filling" aria-label={words ? undefined : `Fill ${label}`}>{words ?? "Fill"}</Pending>
    {state.error && <span className="fill-now-why" role="alert">{state.error}</span>}
  </form>;
}
