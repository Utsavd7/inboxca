"use client";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Item, List } from "../motion";
import { Avatar, Badge, CountPill } from "../ui";
import { moveLead } from "./actions";

export type LeadCard = { id: string; name: string; stage: string; service: string; urgent: boolean; due: "late" | "today" | ""; follow: string };
export type Column = { stage: string; title: string; more: number };

// The board (PLAN.md 5.12): a column a stage. A card moves by drag and drop, or with its Move
// menu, which works from the keyboard too, and glides to its new column (motion.tsx Item).
// Won and Lost ask first, in the lead's panel; the rest move at once and are saved behind.
export function Board({ columns, cards, won, open, locked }: { columns: Column[]; cards: LeadCard[]; won: { id: string; name: string }[]; open: string; locked: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [shown, place] = useOptimistic(cards, (now, moved: { id: string; stage: string }) => now.map((card) => (card.id === moved.id ? { ...card, stage: moved.stage } : card)));
  const [over, setOver] = useState("");
  const move = (card: LeadCard, stage: string) => {
    if (locked || stage === card.stage) return;
    if (stage === "client" || stage === "lost") return router.push(`/app/leads?lead=${card.id}&do=${stage === "client" ? "won" : "lost"}`, { scroll: false });
    start(async () => {
      place({ id: card.id, stage });
      await moveLead(card.id, stage);
    });
  };
  return (
    <div className="leads-board" aria-label="Leads by stage" role="group">
      {columns.map((column) => {
        const here = shown.filter((card) => card.stage === column.stage);
        const count = column.stage === "client" ? won.length : here.length + column.more;
        return (
          <section
            key={column.stage}
            className={`lead-col${over === column.stage ? " is-over" : ""}`}
            aria-labelledby={`col-${column.stage}`}
            onDragOver={(event) => {
              if (locked) return;
              event.preventDefault();
              setOver(column.stage);
            }}
            onDragLeave={() => setOver((now) => (now === column.stage ? "" : now))}
            onDrop={(event) => {
              event.preventDefault();
              setOver("");
              const card = shown.find((one) => one.id === event.dataTransfer.getData("text/plain"));
              if (card) move(card, column.stage);
            }}
          >
            <header className="lead-col-head">
              <h2 id={`col-${column.stage}`}>{column.title}</h2>
              <CountPill>{count}</CountPill>
            </header>
            <List className="lead-cards" label={`${column.title} leads`}>
              {column.stage === "client"
                ? won.map((client) => (
                    <Item key={client.id} layoutId={client.id} className="lead-card">
                      <div className="lead-face">
                        <span className="lead-top">
                          <Avatar name={client.name} />
                          <Link href={`/app/clients/${client.id}`}>{client.name}</Link>
                        </span>
                        <span className="lead-meta">Now a client</span>
                      </div>
                    </Item>
                  ))
                : here.map((card) => (
                    <Item key={card.id} layoutId={card.id} className={`lead-card${card.id === open ? " is-open" : ""}`}>
                      <div
                        className="lead-face"
                        draggable={!locked}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", card.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <span className="lead-top">
                          <Avatar name={card.name} />
                          <Link href={`/app/leads?lead=${card.id}`} scroll={false}>
                            {card.name}
                          </Link>
                          {!locked && <MoveMenu card={card} columns={columns} move={move} />}
                        </span>
                        <span className="lead-meta">{card.service}</span>
                        {(card.urgent || card.follow) && (
                          <span className="lead-tags">
                            {card.urgent && <Badge tone="blue">This week</Badge>}
                            {card.follow && <Badge tone={card.due === "late" ? "late" : card.due === "today" ? "warn" : ""}>{card.follow}</Badge>}
                          </span>
                        )}
                      </div>
                    </Item>
                  ))}
            </List>
            {!count && <p className="lead-col-none">{column.stage === "client" ? "Leads you win show here for 30 days." : "Drag a lead here"}</p>}
            {column.more > 0 && <p className="lead-more">{column.more} more not shown</p>}
          </section>
        );
      })}
    </div>
  );
}

// Move to another stage, from the keyboard or the pointer.
function MoveMenu({ card, columns, move }: { card: LeadCard; columns: Column[]; move: (card: LeadCard, stage: string) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="b b-ghost b-icon lead-move" aria-label={`Move ${card.name}`}>
        <ChevronDown size={16} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="menu-layer">
          <Menu.Popup className="menu-pop">
            {columns
              .filter((column) => column.stage !== card.stage)
              .map((column) => (
                <Menu.Item key={column.stage} className="menu-item" onClick={() => move(card, column.stage)}>
                  {column.stage === "client" ? "Won: turn into a client" : column.stage === "lost" ? "Lost" : `Move to ${column.title}`}
                </Menu.Item>
              ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
