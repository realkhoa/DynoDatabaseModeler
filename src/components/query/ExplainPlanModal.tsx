/**
 * @file ExplainPlanModal.tsx
 * @brief Interactive visual query execution plan analyzer modal.
 * @details Displays hierarchical execution plan trees from EXPLAIN queries, highlighting
 * costly operations (full table scans, temp b-trees) and performance bottlenecks in real-time.
 */

import React, { useState, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  AlertTriangle,
  Zap,
  Activity,
  Layers,
  Clock,
  Database,
} from 'lucide-react';
import type { ExecutionPlanNode } from '../../types/database';

/**
 * @brief Properties accepted by the ExplainPlanModal component.
 */
export interface ExplainPlanModalProps {
  /** @brief Whether the explain modal dialog is currently visible. */
  isOpen: boolean;
  /** @brief Callback triggered when the modal is closed or dismissed. */
  onClose: () => void;
  /** @brief SQL query string that was analyzed. */
  query: string;
  /** @brief Parsed root execution plan tree node. */
  plan: ExecutionPlanNode | null;
  /** @brief Whether the explain query is currently executing in backend. */
  isLoading?: boolean;
  /** @brief Optional error message if the explain query failed. */
  error?: string | null;
}

/**
 * @brief Computes maximum and total cost across an entire execution plan tree.
 * @param node Root execution plan node.
 * @return Tuple of total cost and maximum single-node cost.
 */
function analyzePlanCosts(node: ExecutionPlanNode): { totalCost: number; maxCost: number } {
  let maxCost = node.cost;
  let totalCost = node.cost;

  function traverse(n: ExecutionPlanNode) {
    if (n.cost > maxCost) maxCost = n.cost;
    for (const child of n.children || []) {
      totalCost += child.cost;
      traverse(child);
    }
  }

  for (const child of node.children || []) {
    traverse(child);
  }

  return { totalCost: Math.max(1, totalCost), maxCost: Math.max(1, maxCost) };
}

/**
 * @brief Counts the total number of operations in a plan tree.
 * @param node Root execution plan node.
 * @return Total number of plan nodes.
 */
function countPlanNodes(node: ExecutionPlanNode): number {
  let count = 1;
  for (const child of node.children || []) {
    count += countPlanNodes(child);
  }
  return count;
}

/**
 * @brief Single recursive node item in the execution plan tree visualizer.
 */
const PlanNodeItem: React.FC<{
  node: ExecutionPlanNode;
  depth: number;
  maxCost: number;
}> = ({ node, depth, maxCost }) => {
  const isScan =
    node.node_type.toLowerCase().includes('scan') &&
    !node.node_type.toLowerCase().includes('index');
  const isBottleneck = isScan || (node.cost > 0 && node.cost >= maxCost * 0.7);
  const costPercent = Math.min(100, Math.round((node.cost / maxCost) * 100));

  return (
    <div
      data-testid="explain-node"
      className="flex flex-col gap-2 my-1.5 transition-all"
      style={{ marginLeft: `${depth * 24}px` }}
    >
      <div
        className={`flex items-start justify-between p-3 rounded-lg border text-xs shadow-md ${
          isBottleneck
            ? 'bg-rose-950/30 border-rose-600/50 text-rose-100 ring-1 ring-rose-500/30'
            : isScan
            ? 'bg-amber-950/30 border-amber-600/50 text-amber-100'
            : 'bg-[#222428] border-[#30333a] text-[#e6e8ea]'
        }`}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-mono font-semibold px-2 py-0.5 rounded text-[11px] ${
                isBottleneck
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
              }`}
            >
              {node.node_type}
            </span>

            {node.relation_name && (
              <span className="flex items-center gap-1 font-mono font-bold text-[#e6e8ea] bg-[#141517] px-2 py-0.5 rounded border border-[#2c2e33]">
                <Database className="w-3 h-3 text-cyan-400" />
                {node.relation_name}
              </span>
            )}

            {isBottleneck && (
              <span
                data-testid="explain-bottleneck-badge"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px] uppercase tracking-wider"
              >
                <AlertTriangle className="w-3 h-3" />
                Bottleneck
              </span>
            )}
          </div>

          {node.detail && (
            <p className="text-[11px] font-mono text-[#8c919a] mt-0.5 leading-relaxed">
              {node.detail}
            </p>
          )}
        </div>

        {/* Metrics Column */}
        <div className="flex flex-col items-end gap-1 text-right shrink-0 ml-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#8c919a]">Cost:</span>
            <span className="font-mono font-semibold text-[#e6e8ea]">
              {node.cost.toFixed(1)}
            </span>
          </div>

          {node.rows > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#8c919a]">Rows:</span>
              <span className="font-mono text-[#c4c7cc]">{node.rows}</span>
            </div>
          )}

          {node.actual_time_ms !== undefined && node.actual_time_ms !== null && (
            <div className="flex items-center gap-1 text-emerald-400 font-mono text-[11px]">
              <Clock className="w-3 h-3" />
              <span>{node.actual_time_ms.toFixed(2)} ms</span>
            </div>
          )}

          {/* Cost Bar */}
          <div className="w-20 bg-black/40 h-1.5 rounded-full overflow-hidden mt-1">
            <div
              className={`h-full rounded-full ${
                isBottleneck ? 'bg-rose-500' : 'bg-cyan-400'
              }`}
              style={{ width: `${Math.max(8, costPercent)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Render Sub-Operations */}
      {node.children && node.children.length > 0 && (
        <div className="border-l border-white/10 pl-2">
          {node.children.map((child, idx) => (
            <PlanNodeItem
              key={idx}
              node={child}
              depth={depth + 1}
              maxCost={maxCost}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * @brief Modal dialog presenting graphical EXPLAIN query execution plan tree.
 * @param props Modal state and plan data payload.
 * @return Rendered dialog element or null if closed.
 */
export const ExplainPlanModal: React.FC<ExplainPlanModalProps> = ({
  isOpen,
  onClose,
  query,
  plan,
  isLoading = false,
  error = null,
}) => {
  const [copied, setCopied] = useState(false);

  const { maxCost } = useMemo(() => {
    if (!plan) return { totalCost: 1, maxCost: 1 };
    return analyzePlanCosts(plan);
  }, [plan]);

  const totalOperations = useMemo(() => {
    if (!plan) return 0;
    return countPlanNodes(plan);
  }, [plan]);

  if (!isOpen) return null;

  const handleCopyJson = () => {
    if (plan) {
      navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      data-testid="explain-plan-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className="bg-[#18191c] border border-[#2c2e33] rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-[#e6e8ea]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2c2e33] bg-[#1f2024]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-cyan-500/20 text-cyan-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#e6e8ea] tracking-wide">
                Execution Plan Analyzer (EXPLAIN)
              </h2>
              <p className="text-[11px] font-mono text-[#8c919a] truncate max-w-md">
                {query}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {plan && (
              <button
                type="button"
                data-testid="explain-copy-btn"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-1.5 bg-[#2a2c31] hover:bg-[#34373d] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#393c44] transition-colors"
                title="Copy plan JSON"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              data-testid="explain-close-btn"
              onClick={onClose}
              className="p-1.5 rounded-md text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2c2e33] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Telemetry Bar */}
        {plan && !isLoading && (
          <div className="flex items-center gap-6 px-5 py-2.5 bg-[#141517] border-b border-[#232529] text-xs font-mono text-[#8c919a]">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Operations:</span>
              <span className="font-bold text-[#e6e8ea]">{totalOperations}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>Root Cost:</span>
              <span className="font-bold text-[#e6e8ea]">{plan.cost.toFixed(1)}</span>
            </div>
            {plan.actual_time_ms !== undefined && plan.actual_time_ms !== null && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Execution Time:</span>
                <span className="font-bold text-emerald-300">
                  {plan.actual_time_ms.toFixed(2)} ms
                </span>
              </div>
            )}
          </div>
        )}

        {/* Body Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#8c919a]">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs font-medium">Analyzing query plan...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-600/50 text-rose-200 text-xs">
              <div className="flex items-center gap-2 font-bold mb-1">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>Execution Plan Analysis Failed</span>
              </div>
              <p className="font-mono text-[11px] whitespace-pre-wrap">{error}</p>
            </div>
          ) : plan ? (
            <div data-testid="explain-plan-tree" className="space-y-1">
              <PlanNodeItem node={plan} depth={0} maxCost={maxCost} />
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-[#8c919a]">
              No execution plan generated for this query.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-[#2c2e33] bg-[#1f2024]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs bg-[#2a2c31] hover:bg-[#34373d] text-[#e6e8ea] border border-[#393c44] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
