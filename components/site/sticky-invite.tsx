"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { guarantee } from "@/content/site";

// On phones the invite button stays in reach: it slides up once the buttons at the
// top have scrolled away, and steps aside when the closing invite comes into view.
export function StickyInvite() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const top = document.querySelector(".hero-actions");
    const end = document.getElementById("invite");
    if (!top || !end) return;
    let passedTop = false;
    let atEnd = false;
    const update = () => setShow(passedTop && !atEnd);
    const watchTop = new IntersectionObserver(([entry]) => {
      passedTop = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      update();
    });
    const watchEnd = new IntersectionObserver(
      ([entry]) => {
        atEnd = entry.isIntersecting;
        update();
      },
      { threshold: 0.15 },
    );
    watchTop.observe(top);
    watchEnd.observe(end);
    return () => {
      watchTop.disconnect();
      watchEnd.disconnect();
    };
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="sticky-invite"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
        >
          <span className="guarantee">{guarantee}</span>
          <a
            className="btn"
            href="#invite"
            data-open-dialog="invite"
            aria-haspopup="dialog"
          >
            Ask for an invite
          </a>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
