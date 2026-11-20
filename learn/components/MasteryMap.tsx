'use client';

import { useMemo } from 'react';
import { layoutDag } from '@/lib/tutor/dag-layout';
import type { MasteryView } from '@/lib/tutor/api';
import type { ConceptGraphSpec, ConceptStatus } from '@/lib/tutor/types';

const NODE_W = 150;
const NODE_H = 38;
const COL_GAP = 46;
const ROW_GAP = 14;
const PAD = 12;

const STATUS_STYLE: Record<ConceptStatus, { fill: string; stroke: string; label: string }> = {
  unknown: { fill: '#e2e8f0', stroke: '#94a3b8', label: 'Not assessed' },
  learning: { fill: '#fde68a', stroke: '#d97706', label: 'Learning' },
  mastered: { fill: '#a7f3d0', stroke: '#059669', label: 'Mastered' },
  misconception: { fill: '#fecdd3', stroke: '#e11d48', label: 'Misconception' },
};

interface MasteryMapProps {
  spec: ConceptGraphSpec;
  mastery: MasteryView;
  /** Concepts the tutor is currently working on (target / probed prerequisite). */
  highlight?: string[];
}

/** Prerequisite DAG, left (foundations) to right (advanced), colored by learner status. */
export function MasteryMap({ spec, mastery, highlight = [] }: MasteryMapProps) {
  const { nodes, width, height } = useMemo(() => {
    const layout = layoutDag(spec);
    const layers = Math.max(...layout.map((n) => n.layer)) + 1;
    const rows = Math.max(...layout.map((n) => n.order)) + 1;
    return {
      nodes: new Map(
        layout.map((n) => [n.id, { x: PAD + n.layer * (NODE_W + COL_GAP), y: PAD + n.order * (NODE_H + ROW_GAP) }])
      ),
      width: PAD * 2 + layers * NODE_W + (layers - 1) * COL_GAP,
      height: PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP,
    };
  }, [spec]);
  const names = useMemo(() => new Map(spec.concepts.map((c) => [c.id, c.name])), [spec]);
  const focus = new Set(highlight);

  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Concept mastery map"
          className="block"
        >
          <defs>
            <marker id="mastery-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
            </marker>
          </defs>
          {spec.edges.map((edge) => {
            const from = nodes.get(edge.from);
            const to = nodes.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={1.2}
                markerEnd="url(#mastery-arrow)"
              />
            );
          })}
          {[...nodes.entries()].map(([id, pos]) => {
            const view = mastery[id] ?? { mastery: 0, status: 'unknown' as const };
            const style = STATUS_STYLE[view.status];
            const name = names.get(id) ?? id;
            const isFocus = focus.has(id);
            return (
              <g key={id} transform={`translate(${pos.x},${pos.y})`}>
                <title>{`${name}: ${style.label}, mastery ${view.mastery.toFixed(2)}`}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill={style.fill}
                  fillOpacity={0.35 + 0.65 * view.mastery}
                  stroke={isFocus ? '#0284c7' : style.stroke}
                  strokeWidth={isFocus ? 3 : 1.2}
                />
                {/* Mastery bar along the bottom edge. */}
                <rect x={8} y={NODE_H - 7} width={(NODE_W - 16) * view.mastery} height={3} rx={1.5} fill={style.stroke} />
                <text x={NODE_W / 2} y={NODE_H / 2 + 1} textAnchor="middle" fontSize={11} fill="#0f172a">
                  {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {(Object.keys(STATUS_STYLE) as ConceptStatus[]).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ background: STATUS_STYLE[status].fill, border: `1px solid ${STATUS_STYLE[status].stroke}` }}
            />
            {STATUS_STYLE[status].label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border-2 border-sky-600" />
          Current focus
        </li>
      </ul>
    </div>
  );
}
