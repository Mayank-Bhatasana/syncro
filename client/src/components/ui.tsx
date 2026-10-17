const AVATAR_COLORS = [
  "bg-sun",
  "bg-bubble",
  "bg-azure",
  "bg-mint",
  "bg-grape",
  "bg-tangerine",
];

export function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function getAvatarColor(seed: string) {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full border-2 border-ink font-display font-extrabold text-ink shadow-pop-sm ${getAvatarColor(
        name
      )} ${size === "sm" ? "w-8 h-8 text-[11px]" : "w-10 h-10 text-sm"}`}
    >
      {getInitials(name)}
    </span>
  );
}
