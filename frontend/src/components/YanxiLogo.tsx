type Variant = "default" | "sm";

const SRC: Record<Variant, string> = {
  default: "/brand/yanxi-logo.png",
  sm: "/brand/yanxi-logo-sm.png",
};

interface Props {
  size?: number;
  variant?: Variant;
  className?: string;
  alt?: string;
}

export default function YanxiLogo({
  size = 32,
  variant = "default",
  className = "",
  alt = "研析",
}: Props) {
  return (
    <img
      src={SRC[variant]}
      alt={alt}
      width={size}
      height={size}
      className={`yanxi-logo${className ? ` ${className}` : ""}`}
      draggable={false}
    />
  );
}
