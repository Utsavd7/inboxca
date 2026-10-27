"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { custom, planRows, plans, practices, rupees } from "@/content/plans";
import { estimate, type Practice } from "@/src/lib/estimate";
import { Rolling } from "./rolling";

const spring = { type: "spring", duration: 0.55, bounce: 0.16 } as const;
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

function FitTag() {
  return (
    <motion.span layoutId="plan-fit" className="plan-fit" transition={spring}>
      Fits your firm
    </motion.span>
  );
}

export function Plans() {
  const id = useId();
  const [yearly, setYearly] = useState(false);
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
            <div
              className="segment segment-light"
              role="group"
              aria-labelledby={`${id}-practice`}
            >
              {practices.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={practice === key}
                  onClick={() => setPractice(key)}
                >
                  {practice === key && (
                    <motion.span
                      layoutId="practice-pick"
                      className="segment-pick"
                      transition={spring}
                    />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="finder-field finder-team">
            <label htmlFor={`${id}-team`}>How big is your team, you included?</label>
            <div className="stepper">
              <button
                type="button"
                aria-label="One person fewer"
                onClick={() => changeTeam(team - 1)}
                disabled={team <= 1}
              >
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
              <button
                type="button"
                aria-label="One more person"
                onClick={() => changeTeam(team + 1)}
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="quote">
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
          <ul className="quote-facts">
            <li>
              About <span className="num">{returns}</span> returns a year
            </li>
            {result.custom ? (
              <li>
                <span className="num">{number(result.aiCredits)}</span> AI
                credits a month
              </li>
            ) : (
              result.extraPeople > 0 && (
                <li>
                  Add <span className="num">{rupees(result.extraCost)}</span> a
                  month for <span className="num">{result.extraPeople}</span>{" "}
                  more {result.extraPeople === 1 ? "person" : "people"}
                </li>
              )
            )}
          </ul>
          <div className="segment" role="group" aria-label="Billing period">
            {(
              [
                [false, "Monthly"],
                [true, "Yearly"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={yearly === value}
                onClick={() => setYearly(value)}
              >
                {yearly === value && (
                  <motion.span
                    layoutId="billing-pick"
                    className="segment-pick"
                    transition={spring}
                  />
                )}
                <span>
                  {label}
                  {value && <em className="free">1 month free</em>}
                </span>
              </button>
            ))}
          </div>
          {/* The saving is the real difference: twelve monthly payments against one yearly one. */}
          <p className="quote-save">
            {yearly ? (
              <>
                You save <span className="num">{rupees(saving)}</span> a year.
              </>
            ) : (
              <button type="button" onClick={() => setYearly(true)}>
                Pay yearly and save{" "}
                <span className="num">{rupees(saving)}</span>
              </button>
            )}
          </p>
          <p className="sr-only" aria-live="polite">
            {name} fits your firm: {rupees(price)} {per}.
          </p>
        </div>
      </div>

      <ul className="plan-grid" ref={grid} tabIndex={0} aria-label="Plans">
        {plans.map((plan, index) => (
          <li key={plan.name} className={`plan ${fit === index ? "is-fit" : ""}`}>
            {fit === index && <FitTag />}
            <h3>{plan.name}</h3>
            <p className="plan-suits">
              Suits about <span className="num">{plan.clients}</span> clients
            </p>
            <p className="plan-price">
              <Price value={yearly ? plan.yearly : plan.monthly} />
              <small>{per}</small>
            </p>
            <dl>
              {planRows.map(([label, key]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd className={key === "team" ? undefined : "num"}>
                    {plan[key]}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <div className={`plan-custom ${result.custom ? "is-fit" : ""}`}>
        {result.custom ? (
          <>
            <FitTag />
            <div className="custom-name">
              <h3>Custom</h3>
              <p className="plan-suits">Worked out for your firm</p>
            </div>
            <p className="plan-price">
              <Price value={yearly ? result.yearly : result.monthly} />
              <small>{per}</small>
            </p>
            <dl>
              <div>
                <dt>Returns a year</dt>
                <dd className="num">
                  about {returns}
                </dd>
              </div>
              <div>
                <dt>Storage a year</dt>
                <dd className="num">{result.storageGb} GB</dd>
              </div>
              <div>
                <dt>AI credits a month</dt>
                <dd className="num">{number(result.aiCredits)}</dd>
              </div>
              <div>
                <dt>Team, you included</dt>
                <dd>
                  {team > custom.includedPeople ? (
                    <>
                      <span className="num">{team}</span> people
                    </>
                  ) : (
                    "Up to 40"
                  )}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="custom-idle">
            <strong>Bigger than Enterprise?</strong> Add more clients, or a team
            above 40, and your Custom price shows here.
          </p>
        )}
      </div>
      <p className="plan-guide">
        An estimate from your answers. Your exact plan is worked out from your
        own client list once you join.
      </p>
    </div>
  );
}
