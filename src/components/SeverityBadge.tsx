'use client';

interface SeverityBadgeProps {
  severity: string;
  size?: 'sm' | 'md';
}

const colorMap: Record<string, string> = {
  CRITICAL: 'badge-critical',
  HIGH: 'badge-high',
  MEDIUM: 'badge-medium',
  LOW: 'badge-low',
};

export default function SeverityBadge({ severity, size = 'sm' }: SeverityBadgeProps) {
  const cls = colorMap[severity] || 'badge-low';
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`inline-flex items-center font-mono font-semibold rounded ${cls} ${sizeClass}`}>
      {severity}
    </span>
  );
}
