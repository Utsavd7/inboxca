// A short burst of paper from a button, for choosing Yearly. In the brand's blues, removed when
// it lands, and nothing at all for visitors who ask for less motion.
const colours = ["#1a4bb0", "#0b1f3a", "#c2d3f7", "#3d6fd6", "#ffffff"];

export function confetti(from: Element) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { left, top, width } = from.getBoundingClientRect();
  for (let piece = 0; piece < 70; piece++) {
    const bit = document.createElement("i");
    bit.className = "confetti";
    bit.style.left = `${left + width / 2}px`;
    bit.style.top = `${top}px`;
    bit.style.background = colours[piece % colours.length];
    document.body.append(bit);
    // Up and out in a wide fan, then falling past where it started.
    const angle = -Math.PI * (0.1 + Math.random() * 0.8), speed = 180 + Math.random() * 320;
    const x = Math.cos(angle) * speed, y = Math.sin(angle) * speed, turn = 360 + Math.random() * 720;
    bit.animate(
      [
        { transform: "translate(-50%, -50%)", opacity: 1 },
        { transform: `translate(${x}px, ${y}px) rotate(${turn / 2}deg)`, opacity: 1, offset: 0.4, easing: "ease-in" },
        { transform: `translate(${x * 1.4}px, ${y + 520}px) rotate(${turn}deg)`, opacity: 0 },
      ],
      { duration: 1500 + Math.random() * 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    ).finished.then(() => bit.remove(), () => bit.remove());
  }
}
