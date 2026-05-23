import YanxiLogo from "./YanxiLogo";

interface Props {
  /** 是否显示「研析」文字（收起侧栏 rail 不显示） */
  showText?: boolean;
  logoSize?: number;
  className?: string;
}

/** 侧栏 / 登录等处的品牌区：Logo + 可选文案 */
export default function BrandMark({
  showText = true,
  logoSize = 32,
  className = "",
}: Props) {
  return (
    <div className={`brand-mark${className ? ` ${className}` : ""}`}>
      <YanxiLogo size={logoSize} className="brand-mark-logo" />
      {showText ? <span className="brand-mark-text">研析</span> : null}
    </div>
  );
}
