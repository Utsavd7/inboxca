"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { questionGroups } from "@/content/site";

// The questions in two groups, one shown at a time; one answer is open at a time.
export function Faq() {
  const [pick, setPick] = useState(0);
  return (
    <div className="faq-list">
      <div className="segment" role="group" aria-label="Choose a group of questions">
        {questionGroups.map(([name], index) => (
          <button key={name} type="button" aria-pressed={pick === index} onClick={() => setPick(index)}>
            {pick === index && (
              <motion.span layoutId="faq-pick" className="segment-pick" transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} />
            )}
            <span>{name}</span>
          </button>
        ))}
      </div>
      {questionGroups.map(([name, list], index) => (
        <div key={name} hidden={pick !== index}>
          {list.map(([question, answer]) => (
            <details key={question} name="faq">
              <summary>
                {question}
                <Plus size={18} aria-hidden />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}
