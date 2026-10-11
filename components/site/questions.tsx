import { ChevronDown } from "lucide-react";
import { questions } from "@/content/site";
export function Questions() {
  return (
    <div className="questions-list">
      {questions.map(([q, a], i) => (
        <details key={q} open={i === 0}>
          <summary>
            <span>{q}</span>
            <ChevronDown size={20} aria-hidden />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
