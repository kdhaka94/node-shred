interface SizeSummaryProps {
  totalSize: number;
  selectedSize: number;
}

export function SizeSummary({ totalSize, selectedSize }: SizeSummaryProps) {
  const formatSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="size-summary">
      <div className="size-item">
        <span className="size-label">Total Size:</span>
        <span className="size-value">{formatSize(totalSize)}</span>
      </div>
      <div className="size-item">
        <span className="size-label">Selected Size:</span>
        <span className="size-value">{formatSize(selectedSize)}</span>
      </div>
    </div>
  );
} 