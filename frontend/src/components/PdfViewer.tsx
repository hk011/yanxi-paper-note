import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Button, InputNumber, Spin } from "antd";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface Props {
  url: string;
}

export default function PdfViewer({ url }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setNumPages(0);
    setCurrentPage(1);
  }, [url]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const pageWidth = containerWidth
    ? Math.max(320, Math.floor((containerWidth - 24) * zoom))
    : 480;

  useEffect(() => {
    const root = containerRef.current?.closest(".compare-panel-body");
    if (!root) return;

    const updateCurrentPage = () => {
      const rootRect = root.getBoundingClientRect();
      const targetY = rootRect.top + 64;
      let nearestPage = 1;
      let nearestDistance = Number.POSITIVE_INFINITY;

      pageRefs.current.forEach((node, index) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (rect.top <= targetY && rect.bottom >= targetY) {
          nearestPage = index + 1;
          nearestDistance = 0;
          return;
        }
        const distance = Math.abs(rect.top - targetY);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPage = index + 1;
        }
      });

      setCurrentPage(nearestPage);
    };

    root.addEventListener("scroll", updateCurrentPage, { passive: true });
    window.addEventListener("resize", updateCurrentPage);
    updateCurrentPage();
    return () => {
      root.removeEventListener("scroll", updateCurrentPage);
      window.removeEventListener("resize", updateCurrentPage);
    };
  }, [numPages, pageWidth]);

  const changeZoom = (delta: number) => {
    setZoom((value) => Math.min(2, Math.max(0.7, Number((value + delta).toFixed(1)))));
  };

  return (
    <div ref={containerRef} className="pdf-viewer">
      <div className="pdf-toolbar">
        <span className="pdf-page-status">
          {currentPage}/{numPages || "?"}
        </span>
        <Button size="small" disabled={zoom <= 0.7} onClick={() => changeZoom(-0.1)}>
          -
        </Button>
        <InputNumber
          size="small"
          min={70}
          max={200}
          step={10}
          controls={false}
          value={Math.round(zoom * 100)}
          onChange={(value) => {
            if (typeof value === "number") {
              setZoom(Math.min(2, Math.max(0.7, value / 100)));
            }
          }}
          className="pdf-zoom-input"
        />
        <span className="pdf-zoom-percent">%</span>
        <Button size="small" disabled={zoom >= 2} onClick={() => changeZoom(0.1)}>
          +
        </Button>
      </div>
      {loading && <Spin style={{ display: "block", margin: "40px auto" }} />}
      {error && (
        <div style={{ color: "#f5222d", textAlign: "center", padding: 24 }}>{error}</div>
      )}
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => {
          setNumPages(n);
          setLoading(false);
          setError(null);
        }}
        onLoadError={(e) => {
          setLoading(false);
          setError(e?.message || "PDF 加载失败");
        }}
        loading={null}
      >
        <div className="pdf-pages">
          {Array.from({ length: numPages }, (_, index) => (
            <div
              className="pdf-page-wrap"
              key={index + 1}
              ref={(node) => {
                pageRefs.current[index] = node;
              }}
            >
              <Page
                pageNumber={index + 1}
                width={pageWidth}
                renderTextLayer
                renderAnnotationLayer
                loading={null}
              />
            </div>
          ))}
        </div>
      </Document>
    </div>
  );
}
