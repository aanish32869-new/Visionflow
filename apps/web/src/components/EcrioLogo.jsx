import React from "react";

/**
 * EcrioLogo — SVG recreation of the ((ecrio)). brand mark.
 * Props:
 *   size     — controls overall height (default 32)
 *   variant  — "dark" (default) | "light" — text color
 */
export default function EcrioLogo({ size = 32, variant = "dark" }) {
  const textColor = variant === "light" ? "#FFFFFF" : "#1C2028";
  const redColor = "#C41E2A";
  
  // The new viewBox width is 84
  const scale = size / 32;

  return (
    <svg
      width={Math.round(84 * scale)}
      height={size}
      viewBox="0 0 84 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ecrio logo"
    >
      {/* Left outer wave */}
      <path
        d="M10 8 C4 12, 4 20, 10 24"
        stroke={redColor}
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* Left inner wave */}
      <path
        d="M15 11 C11 14, 11 18, 15 21"
        stroke={redColor}
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* ecrio text */}
      <text
        x="19"
        y="22.5"
        fontFamily="'Arial', sans-serif"
        fontSize="17"
        fontWeight="bold"
        letterSpacing="0"
        fill={textColor}
      >
        ecrio
      </text>

      {/* Right inner wave */}
      <path
        d="M66 11 C70 14, 70 18, 66 21"
        stroke={redColor}
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* Right outer wave */}
      <path
        d="M71 8 C77 12, 77 20, 71 24"
        stroke={redColor}
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* Trademark symbol */}
      <text
        x="76"
        y="11"
        fontFamily="'Arial', sans-serif"
        fontSize="5"
        fontWeight="bold"
        fill={textColor}
      >
        TM
      </text>
    </svg>
  );
}
