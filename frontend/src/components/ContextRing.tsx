import { Tooltip } from "antd";

interface Props {
  used: number;
  limit: number;
  size?: number;
  /** Cursor 风格：仅圆环，不显示中心百分比 */
  minimal?: boolean;
}

export default function ContextRing({
  used,
  limit,
  size = 20,
  minimal = false,
}: Props) {
  const safeLimit = limit > 0 ? limit : 256000;
  const ratio = used / safeLimit;
  const displayRatio = Math.min(Math.max(ratio, 0), 1);
  const stroke = minimal ? 2 : 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - displayRatio);
  const percent = Math.round(displayRatio * 100);
  const overLimit = ratio > 1;

  let color = "#6b7280";
  if (overLimit || ratio > 0.9) color = "#ef4444";
  else if (ratio > 0.7) color = "#f59e0b";
  else if (displayRatio > 0) color = "#374151";

  const tip = overLimit
    ? `上下文已超出上限（${used.toLocaleString()} / ${safeLimit.toLocaleString()} tokens）`
    : `上下文 ${percent}% · ${used.toLocaleString()} / ${safeLimit.toLocaleString()} tokens`;

  return (
    <Tooltip title={tip}>
      <div
        className={`context-ring${minimal ? " context-ring--minimal" : ""}`}
        style={{ width: size, height: size }}
        aria-label={tip}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        {!minimal ? (
          <span className={`context-ring-label${overLimit ? " is-over" : ""}`}>
            {overLimit ? "!" : `${percent}%`}
          </span>
        ) : null}
      </div>
    </Tooltip>
  );
}
