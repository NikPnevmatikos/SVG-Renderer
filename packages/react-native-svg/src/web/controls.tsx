import * as React from 'react';
import type { ControlsPosition, SvgViewerRef } from '../viewer/shared';

export interface WebControlsOptions {
  /** Corner of the viewer. Default `top-right`. */
  position?: ControlsPosition;
  /** Show zoom in / zoom out. Default true. */
  zoom?: boolean;
  /** Show the fit-to-content button. Default true. */
  fit?: boolean;
  /** Zoom factor per click. Default 1.5. */
  zoomStep?: number;
  /** Distance from the viewer edges in pixels. Default 12. */
  inset?: number;
  /** Button labels. Defaults: `+`, `−`, `⤢`. */
  labels?: { zoomIn?: string; zoomOut?: string; fit?: string };
  /** Accessible names. Defaults: `Zoom in`, `Zoom out`, `Fit to content`. */
  accessibilityLabels?: { zoomIn?: string; zoomOut?: string; fit?: string };
  className?: string;
  style?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}

interface ViewerControlsProps {
  api: SvgViewerRef;
  options: WebControlsOptions;
}

const BUTTON: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: 'none',
  padding: 0,
  margin: 0,
  background: 'rgba(17, 24, 39, 0.85)',
  color: '#ffffff',
  fontSize: 18,
  fontWeight: 600,
  lineHeight: '36px',
  textAlign: 'center',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
  userSelect: 'none',
};

function cornerStyle(position: ControlsPosition, inset: number): React.CSSProperties {
  const style: React.CSSProperties = { position: 'absolute', display: 'flex', flexDirection: 'column', gap: 8 };
  if (position.startsWith('top')) style.top = inset;
  else style.bottom = inset;
  if (position.endsWith('right')) style.right = inset;
  else style.left = inset;
  return style;
}

/** Default zoom in / zoom out / fit controls. Rendered by the DOM `SvgViewer` unless `controls={false}`. */
export function ViewerControls({ api, options }: ViewerControlsProps): React.ReactElement | null {
  const {
    position = 'top-right',
    zoom = true,
    fit = true,
    zoomStep = 1.5,
    inset = 12,
    labels,
    accessibilityLabels,
    className,
    style,
    buttonStyle,
  } = options;
  if (!zoom && !fit) return null;
  const button = buttonStyle ? { ...BUTTON, ...buttonStyle } : BUTTON;
  return (
    <div className={className} style={{ ...cornerStyle(position, inset), ...style }}>
      {zoom ? (
        <button type="button" style={button} aria-label={accessibilityLabels?.zoomIn ?? 'Zoom in'} onClick={() => api.zoomBy(zoomStep)}>
          {labels?.zoomIn ?? '+'}
        </button>
      ) : null}
      {zoom ? (
        <button
          type="button"
          style={button}
          aria-label={accessibilityLabels?.zoomOut ?? 'Zoom out'}
          onClick={() => api.zoomBy(1 / zoomStep)}
        >
          {labels?.zoomOut ?? '−'}
        </button>
      ) : null}
      {fit ? (
        <button type="button" style={button} aria-label={accessibilityLabels?.fit ?? 'Fit to content'} onClick={() => api.fitToContent()}>
          {labels?.fit ?? '⤢'}
        </button>
      ) : null}
    </div>
  );
}
