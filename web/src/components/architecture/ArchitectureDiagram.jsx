// Architecture Diagram OS — universal diagram entry point.
// Accepts EITHER the new structured spec ({ spec, viewId } or { view }) OR a
// legacy Mermaid string/object ({ mermaid }). Old data never crashes: anything
// that isn't a valid spec view falls through to the proven legacy renderer in
// ProofViews (which itself is defensive against malformed Mermaid).
import { ArchitectureDiagram as LegacyMermaidDiagram } from '../proof/ProofViews.jsx';
import ArchitectureCanvas from './ArchitectureCanvas.jsx';
import { isArchitectureSpec } from '../../lib/architectureSpec.js';

export default function ArchitectureDiagram({ spec, view, viewId, mermaid, height = 420 }) {
  // 1. Direct view object.
  if (view && Array.isArray(view.nodes) && view.nodes.length) {
    return <ArchitectureCanvas view={view} height={height} />;
  }
  // 2. Spec + viewId (or first view).
  if (isArchitectureSpec(spec)) {
    const v = (spec.views || []).find((x) => x.id === viewId || x.type === viewId) || spec.views[0];
    if (v) return <ArchitectureCanvas view={v} height={height} />;
  }
  // 3. Legacy Mermaid fallback (string or any old object shape).
  return <LegacyMermaidDiagram mermaid={mermaid ?? spec} height={typeof height === 'number' ? Math.min(height, 360) : 320} />;
}
