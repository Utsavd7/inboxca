"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import { aiBlock, custom, extraPerson, gstLine, planIncludes, planRows, plans, practices, rupees, yearlySave } from "@/content/plans";
import { estimate, type Practice } from "@/src/lib/estimate";
import { confetti } from "./confetti";
import { Rolling } from "./rolling";

const spring = { type: "spring", duration: 0.55, bounce: 0 } as const;
const number = (value: number) => value.toLocaleString("en-IN");

// The slider is curved so small firms get as much room as large ones.
const SLIDER_MAX = 3000;
const toClients = (position: number) =>
  Math.max(10, Math.round((SLIDER_MAX * (position / 1000) ** 2) / 10) * 10);
const toPosition = (clients: number) =>
  Math.round(1000 * Math.sqrt(Math.min(clients, SLIDER_MAX) / SLIDER_MAX));

const Price = ({ value }: { value: number }) => (
  <Rolling value={value} format={rupees} />
);

// Three answers on one row, the estimate under them, then the four plans in one row. What
// every plan has is listed once, under the row.
export function Plans() {
  const id = useId();
  const [yearly, setYearly] = useState(false);
  // Choosing Yearly is a saving, so it gets a little celebration.
  const pick = (value: boolean, from: Element) => {
    if (value && !yearly) confetti(from);
    setYearly(value);
  };
  const [clients, setClients] = useState(120);
  const [position, setPosition] = useState(toPosition(120));
  const [practice, setPractice] = useState<Practice>("mixed");
  const [team, setTeam] = useState(5);
  const result = estimate(clients, practice, team);
  const fit = result.index;
  const per = yearly ? "a year" : "a month";
  const grid = useRef<HTMLUListElement>(null);

  // On a phone the plans sit in a row; keep the one that fits in view without moving the page.
  useEffect(() => {
    const strip = grid.current;
    const card = strip?.children[fit] as HTMLElement | undefined;
    if (!strip || !card || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({
      left: card.offsetLeft - (strip.clientWidth - card.clientWidth) / 2,
      behavior: "smooth",
    });
  }, [fit]);
  const changeClients = (value: number) => {
    const next = Math.min(20000, Math.max(0, Math.round(value) || 0));
    setClients(next);
    setPosition(toPosition(next));
  };
  const changeTeam = (value: number) =>
    setTeam(Math.min(500, Math.max(1, Math.round(value) || 1)));

  const name = result.custom ? "Custom" : plans[fit].name;
  const price = yearly ? result.yearly : result.monthly;
  const saving = result.monthly * 12 - result.yearly;
  const returns = number(Math.round(result.returns / 10) * 10);
  // Sign up carries the choice as plain plan answers; the server prices it again from plan_formula.
  const start = (plan: string) =>
    `/sign-up?${new URLSearchParams({ plan: plan.toLowerCase(), cycle: yearly ? "yearly" : "monthly", clients: String(clients), practice, people: String(team) })}`;

  return (
    <div className="plans">
      <div className="estimator">
        <div className="finder">
          <div className="finder-field">
            <div className="finder-top">
              <label htmlFor={`${id}-clients`}>How many clients?</label>
              <input
                id={`${id}-clients`}
                className="finder-number num"
                type="number"
                inputMode="numeric"
                min={1}
                max={20000}
                value={clients || ""}
                onChange={(event) => changeClients(Number(event.target.value))}
              />
            </div>
            <input
              type="range"
              aria-label="Clients, slider"
              min={0}
              max={1000}
              value={position}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPosition(next);
                setClients(toClients(next));
              }}
              style={{ "--fill": `${position / 10}%` } as React.CSSProperties}
              aria-valuetext={`${number(clients)} clients`}
            />
          </div>
          <div className="finder-field">
            <span className="finder-label" id={`${id}-practice`}>
              What kind of practice?
            </span>
            <div className="segment" role="group" aria-labelledby={`${id}-practice`}>
              {practices.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={practice === key} onClick={() => setPractice(key)}>
                  {practice === key && <motion.span layoutId="practice-pick" className="segment-pick" transition={spring} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="finder-field">
            <label htmlFor={`${id}-team`}>How big is your team, you included?</label>
            <div className="stepper">
              <button type="button" aria-label="One person fewer" onClick={() => changeTeam(team - 1)} disabled={team <= 1}>
                <Minus size={16} aria-hidden />
              </button>
              <input
                id={`${id}-team`}
                className="num"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                value={team}
                onChange={(event) => changeTeam(Number(event.target.value))}
              />
              <button type="button" aria-label="One more person" onClick={() => changeTeam(team + 1)}>
                <Plus size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="quote">
          <div className="quote-main">
            <p className="quote-label">Your estimate</p>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={name}
                className="quote-plan"
                initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              >
                {name}
              </motion.p>
            </AnimatePresence>
            <p className="quote-price">
              <Price value={price} />
              <small>{per}</small>
            </p>
          </div>
          <ul className="quote-facts">
            <li>About {returns} returns a year</li>
            {result.custom ? (
              <>
                <li>{result.storageGb} GB storage a year</li>
                <li>{number(result.aiCredits)} AI credits a month</li>
                <li>{team > custom.includedPeople ? `${team} people` : "Up to 40 people"}</li>
              </>
            ) : (
              result.extraPeople > 0 && (
                <li>
                  Add {rupees(result.extraCost)} a month for {result.extraPeople} more{" "}
                  {result.extraPeople === 1 ? "person" : "people"}
                </li>
              )
            )}
          </ul>
          <div className="quote-billing">
            <div className="segment segment-dark" role="group" aria-label="Billing period">
              {(
                [
                  [false, "Monthly"],
                  [true, "Yearly"],
                ] as const
              ).map(([value, label]) => (
                <button key={label} type="button" aria-pressed={yearly === value} onClick={(event) => pick(value, event.currentTarget)}>
                  {yearly === value && <motion.span layoutId="billing-pick" className="segment-pick" transition={spring} />}
                  <span>
                    {label}
                    {/* Yearly is 11 monthly payments and ₹10 for 12 (content/plans.ts yearlySave). */}
                    {value && <em className="deal" aria-hidden>Save {yearlySave}%</em>}
                  </span>
                </button>
              ))}
            </div>
            {/* The saving is the real difference: twelve monthly payments against one yearly one. */}
            <p className="quote-save">
              {yearly ? (
                <>You save {rupees(saving)} a year.</>
              ) : (
                <button type="button" onClick={(event) => pick(true, event.currentTarget)}>
                  Pay yearly and save {rupees(saving)}
                </button>
              )}
            </p>
          </div>
          <Link className="btn btn-light" href={start(name)}>
            Start with {name}
            <ArrowRight size={18} aria-hidden />
          </Link>
          <p className="sr-only" aria-live="polite">
            {name} fits your firm: {rupees(price)} {per}.
          </p>
        </div>
      </div>

      <ul className="plan-grid" ref={grid} tabIndex={0} aria-label="Plans">
        {plans.map((plan, index) => (
          <li key={plan.name} className={`plan ${fit === index ? "is-fit" : ""}`}>
            <div className="plan-head">
              <h3>{plan.name}</h3>
              {fit === index && (
                <motion.span layoutId="plan-fit" className="plan-fit" transition={spring}>
                  Fits your firm
                </motion.span>
              )}
            </div>
            <p className="plan-suits">Suits about {plan.clients} clients</p>
            <div className="plan-price">
              <Price value={yearly ? plan.yearly : plan.monthly} />
              <small>{per}</small>
            </div>
            {/* The other way to pay, so the yearly total always sits beside the monthly figure. */}
            <p className="plan-other">
              {yearly ? "or " : ""}
              <span className="num">{rupees(yearly ? plan.monthly : plan.yearly)}</span>
              {yearly ? " a month" : " a year"}
            </p>
            <dl>
              {planRows.map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd className={key === "team" ? undefined : "num"}>{plan[key]}</dd>
                </div>
              ))}
            </dl>
            <Link className={`btn plan-start ${fit === index ? "" : "btn-quiet"}`} href={start(plan.name)}>
              Start with {plan.name}
            </Link>
          </li>
        ))}
      </ul>

      <p className="plan-note">
        Every plan has unlimited clients. The client count on each plan is only our suggestion, based on its storage and AI
        limits.
        <br />
        One time setup fee with the first payment: {plans.map((plan) => `${plan.name} ${rupees(plan.setup)}`).join(", ")}, Custom
        by its size. It is returned if you cancel within 14 days, before your old files start to be brought in.
      </p>

      <div className="plan-foot">
        <ul className="plan-ticks" aria-label="In every plan">
          {planIncludes.map((line) => (
            <li key={line}>
              <Check size={14} strokeWidth={3} aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        {/* Add ons at the prices in content/plans.ts; the Custom plan is worked out above. */}
        <p className={`plan-custom ${result.custom ? "is-fit" : ""}`}>
          {result.custom ? (
            <strong>Bigger than Enterprise, so Custom is worked out above.</strong>
          ) : (
            <>
              <strong>Bigger than Enterprise?</strong> Add clients or a team above 40 for a Custom price.
            </>
          )}{" "}
          One more person is {rupees(extraPerson)} a month, and {number(aiBlock.credits)} more AI credits{" "}
          {rupees(aiBlock.price)} a month. {gstLine} The exact price is shown before you pay.
        </p>
      </div>
    </div>
  );
}
