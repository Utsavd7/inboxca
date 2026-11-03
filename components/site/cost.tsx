"use client";
import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Rolling } from "./rolling";

const number = (value: number) => value.toLocaleString("en-IN");

// The visitor's own numbers, multiplied out. Nothing here says what InboxCA saves:
// that has not been measured yet, and the tile says so.
export function Cost() {
  const id = useId();
  const [people, setPeople] = useState(3);
  const [hours, setHours] = useState(6);
  const weekly = people * hours;
  const yearly = weekly * 52;
  const days = Math.round(yearly / 8);
  const sliders = [
    {
      key: "people",
      label: "How many people handle client emails and papers?",
      value: people,
      set: setPeople,
      min: 1,
      max: 40,
      unit: people === 1 ? "person" : "people",
    },
    {
      key: "hours",
      label: "Hours a week each one spends chasing, sorting and filing",
      value: hours,
      set: setHours,
      min: 1,
      max: 30,
      unit: hours === 1 ? "hour" : "hours",
    },
  ] as const;
  return (
    <div className="site-tile cost">
      <div className="quote">
        <p className="cost-label">Your firm spends about</p>
        <p className="cost-figure">
          <Rolling value={yearly} format={number} />
          <small>hours a year</small>
        </p>
        <p className="cost-facts">
          That is {number(weekly)} hours every week, or about {number(days)} working days a year.
        </p>
        <p className="cost-note">
          InboxCA is built to take this work over. How much of it comes back to you will be measured with the
          first firms.{" "}
          <a className="text-link" href="#plans">
            Find your plan
            <ArrowRight size={15} aria-hidden />
          </a>
        </p>
        <p className="sr-only" aria-live="polite">
          About {number(yearly)} hours a year.
        </p>
      </div>
      <div className="finder">
        {sliders.map(({ key, label, value, set, min, max, unit }) => (
          <div key={key} className="finder-field">
            <div className="finder-top">
              <label htmlFor={`${id}-${key}`}>{label}</label>
              <output htmlFor={`${id}-${key}`} className="finder-value">
                {value} {unit}
              </output>
            </div>
            <input
              id={`${id}-${key}`}
              type="range"
              min={min}
              max={max}
              value={value}
              onChange={(event) => set(Number(event.target.value))}
              style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
              aria-valuetext={`${value} ${unit}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
